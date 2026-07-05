import type { Context } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { ISSUE_STATUSES } from "@/modules/issue/schema";
import { PROCUREMENT_STATUSES } from "@/modules/procurement/schema";
import { hasCapability, isMember as isProjectMember, resolveProjectId } from "@/modules/project/project.service";
import { NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { authRequired } from "@/shared/middleware/auth";
import { listPinnedByProject } from "./item.service";

const projectIdParam = z.object({ projectId: z.string() });

// Mirrors the `PinnedItem` view returned by `listPinnedByProject` (union of
// pinned issues + procurements). `status` is the issue vocabulary for
// type=issue rows and the procurement vocabulary for type=procurement rows.
const pinnedItemSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  type: z.enum(["issue", "procurement"]),
  title: z.string(),
  status: z.enum([...ISSUE_STATUSES, ...PROCUREMENT_STATUSES]),
  pinnedAt: z.string(),
});

/**
 * Resolve the project ULID from its short id and decide procurement
 * visibility. Fail-closed: a missing project or a non-member surfaces as 404
 * so neither the project's existence nor its pinned set leaks. App admins
 * bypass membership and always see pinned procurements; a member sees pinned
 * procurements only when their role grants `procurement.view`, mirroring the
 * procurement module's own gate.
 */
async function resolvePinnedAccess(c: Context<ProtectedEnv>, projectShortId: string): Promise<{ projectId: string; includeProcurements: boolean }> {
  const db = c.get("db");
  const user = c.get("user");
  const projectId = await resolveProjectId(db, projectShortId);
  if (!projectId)
    throw new NotFoundError("Project", projectShortId);
  if (user.role === "admin")
    return { projectId, includeProcurements: true };
  if (!await isProjectMember(db, projectId, user.id))
    throw new NotFoundError("Project", projectShortId);
  const includeProcurements = await hasCapability(db, projectId, user.id, "procurement.view");
  return { projectId, includeProcurements };
}

export function itemRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // ─── Project Pin area ──────────────────────────────────────────────
  // Mixed union of pinned issues + pinned procurements for a project, ordered
  // by `pinnedAt DESC`. Pinned procurements are omitted for callers without
  // `procurement.view` (issues stay visible to any member).
  router.get(
    "/projects/:projectId/pinned-items",
    describeRoute({
      tags: ["projects"],
      summary: "List a project's pinned items",
      responses: {
        200: okJson(z.array(pinnedItemSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
      },
    }),
    validator("param", projectIdParam, onValidationFailure),
    async (c) => {
      const { projectId: projectShortId } = c.req.valid("param");
      const { projectId, includeProcurements } = await resolvePinnedAccess(c, projectShortId);
      const data = await listPinnedByProject(c.get("db"), projectId, { includeProcurements });
      return c.json({ success: true, data });
    },
  );

  return router;
}
