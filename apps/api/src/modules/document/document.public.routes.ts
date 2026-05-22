import type { PublicSubtreeNode } from "./document.service";
import type { DocumentPublicLinkRow } from "./document.share.service";
import type { AppDatabase } from "@/db";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { buildDownloadResponse, getFileById, getReferenceById, listAttachmentsByOwner } from "@/modules/file";
import { getClientIp } from "@/shared/lib/client-ip";
import { ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { getDocumentByItemId, listPublicSubtree } from "./document.service";
import {
  getPublicLinkByToken,
  isPublicLinkExpired,
  verifyPublicLinkPassword,
} from "./document.share.service";

const accessSchema = z.object({
  password: z.string().optional(),
  /** short_id of a document within the link's subtree; defaults to the link root. */
  docId: z.string().optional(),
});

const attachmentSchema = z.object({
  password: z.string().optional(),
});

/**
 * Resolve a token to an **active, unexpired** public link, or throw a
 * 404 that hides whether the token exists at all. A non-public token
 * never reaches this table (only `document_public_links` rows are
 * looked up), and an inactive/expired link is indistinguishable from a
 * missing one — no existence leak.
 */
async function requireActiveLink(db: AppDatabase, token: string): Promise<DocumentPublicLinkRow> {
  const link = await getPublicLinkByToken(db, token);
  if (!link || link.isActive !== 1 || isPublicLinkExpired(link))
    throw new NotFoundError("Shared document", token);
  return link;
}

/** Enforce the link password (no-op for password-less links). 403 on mismatch. */
async function enforcePassword(link: DocumentPublicLinkRow, password: string | undefined): Promise<void> {
  if (link.password === null)
    return;
  if (!password)
    throw new ForbiddenError("Password required");
  if (!(await verifyPublicLinkPassword(link, password)))
    throw new ForbiddenError("Invalid password");
}

/**
 * Resolve the link's subtree and pick the addressed node. The root is
 * the document the link is on; `docId` (a short_id) selects any
 * descendant. A `docId` outside the subtree — or a soft-deleted /
 * missing root — resolves to 404 so the subtree cannot be probed.
 */
async function resolveSubtreeTarget(
  db: AppDatabase,
  link: DocumentPublicLinkRow,
  docShortId: string | undefined,
): Promise<{ subtree: readonly PublicSubtreeNode[]; target: PublicSubtreeNode }> {
  const subtree = await listPublicSubtree(db, link.documentId);
  // Empty subtree ⇒ the link's own document is gone (or soft-deleted).
  const root = subtree.find(n => n.itemId === link.documentId);
  if (!root)
    throw new NotFoundError("Shared document", link.token);
  const target = docShortId
    ? subtree.find(n => n.id === docShortId)
    : root;
  if (!target)
    throw new NotFoundError("Shared document", docShortId ?? link.token);
  return { subtree, target };
}

/**
 * Unauthenticated, view-only access to a document via a public link.
 * Mounted in `routes/public.ts` (no `authRequired`). A link on a folder
 * document grants the same view-only access to every descendant: the
 * subtree is addressed by `docId` (a descendant's short_id) on the same
 * token. Revoking the link (or its expiry) kills the whole subtree.
 *
 *  - `GET  /documents/shared/:token`              — gate metadata only
 *  - `POST /documents/shared/:token`              — document content + subtree
 *  - `POST /documents/shared/:token/attachments/:aid` — stream an attachment
 *
 * None of these paths can edit, comment, or otherwise mutate state. The
 * password hash is never serialized; unknown / inactive / expired links
 * and out-of-subtree documents return 404, never 403, to avoid leaking
 * existence.
 */
export function documentPublicRoutes() {
  const router = new Hono<AppEnv>();

  // Gate metadata: enough to render the password prompt, nothing more.
  router.get("/documents/shared/:token", async (c) => {
    const token = c.req.param("token");
    const link = await requireActiveLink(c.get("db"), token);
    const doc = await getDocumentByItemId(c.get("db"), link.documentId);
    if (!doc)
      throw new NotFoundError("Shared document", token);
    return c.json({
      success: true,
      data: {
        token: link.token,
        title: doc.title,
        hasPassword: link.password !== null,
      },
    });
  });

  // Content access: verify password, then return the addressed document
  // (root or descendant) with its attachments and the navigable subtree.
  router.post("/documents/shared/:token", async (c) => {
    const db = c.get("db");
    const token = c.req.param("token");
    const body = accessSchema.parse(await c.req.json().catch(() => ({})));

    const link = await requireActiveLink(db, token);
    await enforcePassword(link, body.password);

    const { subtree, target } = await resolveSubtreeTarget(db, link, body.docId);
    const composed = await getDocumentByItemId(db, target.itemId);
    if (!composed)
      throw new NotFoundError("Shared document", body.docId ?? token);
    // Scope parentId to the shared subtree: the link root reports
    // parentId=null even when it has a (non-shared) parent, so we never
    // leak an ancestor short_id outside the public link's scope.
    const document = { ...composed, parentId: target.parentId };
    const attachments = await listAttachmentsByOwner(db, "item_attachment", target.itemId);

    await audit(db, c.get("logger"), {
      actorId: "client:public",
      actorName: "client:public",
      action: "document.share.accessed",
      resourceType: "document_public_link",
      resourceId: token,
      resourceName: document.title,
      detail: { docId: document.id, kind: "content" },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    });

    return c.json({
      success: true,
      data: {
        token: link.token,
        hasPassword: link.password !== null,
        document,
        attachments,
        subtree: subtree.map(n => ({ id: n.id, title: n.title, parentId: n.parentId })),
      },
    });
  });

  // Attachment view/download: password-gated like content access. The
  // attachment's owning document must live in the link's subtree.
  router.post("/documents/shared/:token/attachments/:aid", async (c) => {
    const db = c.get("db");
    const token = c.req.param("token");
    const aid = c.req.param("aid");
    const body = attachmentSchema.parse(await c.req.json().catch(() => ({})));

    const link = await requireActiveLink(db, token);
    await enforcePassword(link, body.password);

    const ref = await getReferenceById(db, aid);
    if (!ref || ref.ownerType !== "item_attachment")
      throw new NotFoundError("Attachment", aid);

    // IDOR guard: the attachment's owner document must be inside the
    // link's subtree, otherwise any token could pull any attachment.
    const subtree = await listPublicSubtree(db, link.documentId);
    if (!subtree.some(n => n.itemId === ref.ownerId))
      throw new NotFoundError("Attachment", aid);

    const file = await getFileById(db, ref.fileId);
    if (!file)
      throw new NotFoundError("Attachment", aid);

    await audit(db, c.get("logger"), {
      actorId: "client:public",
      actorName: "client:public",
      action: "document.share.accessed",
      resourceType: "document_public_link",
      resourceId: token,
      resourceName: ref.filename,
      detail: { attachmentId: aid, kind: "attachment" },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    });

    const wantInline = c.req.query("inline") === "true";
    return await buildDownloadResponse(c.get("config"), file, ref, { inline: wantInline });
  });

  return router;
}
