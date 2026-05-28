import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { hasCapability, isMember as isProjectMember, resolveProjectId } from "@/modules/project/project.service";
import { NotFoundError } from "@/shared/lib/errors";
import { authRequired } from "@/shared/middleware/auth";
import { listPinnedByProject } from "./item.service";

/**
 * Resolve the project ULID from its short id and decide procurement
 * visibility. Fail-closed: a missing project or a non-member surfaces as 404
 * so neither the project's existence nor its pinned set leaks. App admins
 * bypass membership and always see pinned procurements; a member sees pinned
 * procurements only when their role grants `procurement.view`, mirroring the
 * procurement module's own gate.
 */
async function resolvePinnedAccess(c: Context<AppEnv>, projectShortId: string): Promise<{ projectId: string; includeProcurements: boolean }> {
  const db = c.get("db");
  const user = c.get("user")!;
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
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  // ─── Project Pin area ──────────────────────────────────────────────
  // Mixed union of pinned issues + pinned procurements for a project, ordered
  // by `pinnedAt DESC`. Pinned procurements are omitted for callers without
  // `procurement.view` (issues stay visible to any member).
  router.get("/projects/:projectId/pinned-items", async (c) => {
    const { projectId, includeProcurements } = await resolvePinnedAccess(c, c.req.param("projectId"));
    const data = await listPinnedByProject(c.get("db"), projectId, { includeProcurements });
    return c.json({ success: true, data });
  });

  return router;
}
