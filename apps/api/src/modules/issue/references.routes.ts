import type { Context, Hono } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { requireParam } from "@/shared/lib/route-params";
import { resolveIssueItem, resolveIssueProjectId, resolveProjectIssueAccess } from "./issue.service";
import { ISSUE_REFERENCE_TYPES } from "./references.schema";
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

const issueShortIdParam = z.object({ issueShortId: z.string() });

// Mirrors `ResolvedWorklist` / `IssueReferenceView` returned by the service.
const resolvedWorklistSchema = z.object({
  id: z.string(),
  name: z.string(),
  checklist: z.string().nullable(),
  precautions: z.string().nullable(),
});
const referenceViewSchema = z.object({
  id: z.string(),
  // Stored as open-ended text, but every write path validates against the
  // known set, so responses always carry one of these.
  refType: z.enum(ISSUE_REFERENCE_TYPES),
  refId: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
  worklist: resolvedWorklistSchema.nullable().optional(),
});

/**
 * Resolve an issue by short id and assert the actor's access, reusing the issue
 * module's project-membership / `issue.manage` gate. `mutating` requires edit
 * rights (pm or creator); read requires membership. Fail-closed: an unknown
 * issue and a non-member both surface as 404 so issue existence never leaks.
 */
async function requireIssueAccess(c: Context<ProtectedEnv>, mutating: boolean) {
  const db = c.get("db");
  const user = c.get("user");
  const issueShort = requireParam(c, "issueShortId");

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
export function mountIssueReferenceRoutes(router: Hono<ProtectedEnv>): void {
  // ─── List ──────────────────────────────────────────────────────────
  router.get(
    "/issues/:issueShortId/references",
    describeRoute({
      tags: ["issues"],
      summary: "List issue references",
      responses: {
        200: okJson(z.array(referenceViewSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Issue not found", ...errorJson },
      },
    }),
    validator("param", issueShortIdParam, onValidationFailure),
    async (c) => {
      const { db, item } = await requireIssueAccess(c, false);
      const data = await listReferences(db, item.id);
      return c.json({ success: true, data });
    },
  );

  // ─── Add ───────────────────────────────────────────────────────────
  router.post(
    "/issues/:issueShortId/references",
    describeRoute({
      tags: ["issues"],
      summary: "Add an issue reference",
      responses: {
        201: okJson(referenceViewSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Issue not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", issueShortIdParam, onValidationFailure),
    validator("json", addSchema, onValidationFailure),
    async (c) => {
      const { db, item, issueShort } = await requireIssueAccess(c, true);
      const body = c.req.valid("json");
      const ref = await addReference(db, item.id, body);
      await auditFromCtx(c, {
        action: "issue.reference_added",
        resourceType: "issue",
        resourceId: issueShort,
        resourceName: item.title,
        detail: { referenceId: ref.id, refType: ref.refType, refId: ref.refId },
        result: "success",
      });
      return c.json({ success: true, data: ref }, 201);
    },
  );

  // ─── Delete ────────────────────────────────────────────────────────
  router.delete(
    "/issues/:issueShortId/references/:referenceId",
    describeRoute({
      tags: ["issues"],
      summary: "Delete an issue reference",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Reference not found", ...errorJson },
      },
    }),
    validator("param", z.object({ issueShortId: z.string(), referenceId: z.string() }), onValidationFailure),
    async (c) => {
      const { db, item, issueShort } = await requireIssueAccess(c, true);
      const { referenceId } = c.req.valid("param");
      const removed = await deleteReference(db, item.id, referenceId);
      if (!removed)
        throw new NotFoundError("Reference", referenceId);
      await auditFromCtx(c, {
        action: "issue.reference_removed",
        resourceType: "issue",
        resourceId: issueShort,
        resourceName: item.title,
        detail: { referenceId },
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );
}
