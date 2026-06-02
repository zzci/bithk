import type { Context, Hono } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { resolveIssueItem, resolveIssueProjectId, resolveProjectIssueAccess } from "./issue.service";
import {
  addReference,
  deleteReference,
  listReferences,
} from "./references.service";

// Generic references on an issue. `refType` is open-ended `text` in storage but
// constrained here to the known set; `refId` is a soft reference (no FK).
export const referenceInputSchema = z.object({
  refType: z.enum(["worklist", "url", "document"]),
  refId: z.string().min(1).max(255),
  label: z.string().max(255).nullable().optional(),
});

const addSchema = referenceInputSchema;

function auditMeta(c: Context) {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
}

/**
 * Resolve an issue by short id and assert the actor's access, reusing the issue
 * module's project-membership / `issue.manage` gate. `mutating` requires edit
 * rights (pm or creator); read requires membership. Fail-closed: an unknown
 * issue and a non-member both surface as 404 so issue existence never leaks.
 */
async function requireIssueAccess(c: Context<AppEnv>, mutating: boolean) {
  const db = c.get("db");
  const user = c.get("user")!;
  const issueShort = c.req.param("issueShortId")!;

  const item = await resolveIssueItem(db, issueShort);
  if (!item)
    throw new NotFoundError("Issue", issueShort);
  const projectId = await resolveIssueProjectId(db, issueShort);
  if (!projectId)
    throw new NotFoundError("Issue", issueShort);

  const access = await resolveProjectIssueAccess(db, item, projectId, user.id);
  const isAdmin = user.role === "admin";
  if (!isAdmin && !access.canRead)
    throw new NotFoundError("Issue", issueShort);
  if (mutating && !isAdmin && !access.canEdit)
    throw new ForbiddenError();
  return { db, user, item, issueShort };
}

/**
 * Mount the generic-reference routes onto the issue router. Additive — issue
 * core routes are untouched.
 */
export function mountIssueReferenceRoutes(router: Hono<AppEnv>): void {
  // ─── List ──────────────────────────────────────────────────────────
  router.get("/issues/:issueShortId/references", async (c) => {
    const { db, item } = await requireIssueAccess(c, false);
    const data = await listReferences(db, item.id);
    return c.json({ success: true, data });
  });

  // ─── Add ───────────────────────────────────────────────────────────
  router.post("/issues/:issueShortId/references", async (c) => {
    const { db, user, item, issueShort } = await requireIssueAccess(c, true);
    const body = addSchema.parse(await c.req.json());
    const ref = await addReference(db, item.id, body);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "issue.reference_added",
      resourceType: "issue",
      resourceId: issueShort,
      resourceName: item.title,
      detail: { referenceId: ref.id, refType: ref.refType, refId: ref.refId },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: ref }, 201);
  });

  // ─── Delete ────────────────────────────────────────────────────────
  router.delete("/issues/:issueShortId/references/:referenceId", async (c) => {
    const { db, user, item, issueShort } = await requireIssueAccess(c, true);
    const referenceId = c.req.param("referenceId");
    const removed = await deleteReference(db, item.id, referenceId);
    if (!removed)
      throw new NotFoundError("Reference", referenceId);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "issue.reference_removed",
      resourceType: "issue",
      resourceId: issueShort,
      resourceName: item.title,
      detail: { referenceId },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: null });
  });
}
