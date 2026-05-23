import type { Context } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import {
  addMember,
  composeMember,
  composeProject,
  createProject,
  getProjectByShortId,
  getRole,
  listMembers,
  listProjects,
  removeMember,
  resolveProjectId,
  softDeleteProject,
  updateMember,
  updateProject,
} from "./project.service";

const createProjectSchema = z.object({
  code: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255),
  status: z.enum(["active", "archived", "closed"]).optional(),
  description: z.string().max(2000).nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

const updateProjectSchema = z.object({
  code: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255).optional(),
  status: z.enum(["active", "archived", "closed"]).optional(),
  description: z.string().max(2000).nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
}).refine(
  v => Object.values(v).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

const listSchema = z.object({
  status: z.enum(["active", "archived", "closed"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const addMemberSchema = z.object({
  memberType: z.enum(["internal", "external"]),
  role: z.enum(["pm", "member"]).optional(),
  userId: z.string().min(1).nullable().optional(),
  displayName: z.string().max(255).nullable().optional(),
  externalRef: z.string().max(255).nullable().optional(),
  supplierInfo: z.string().nullable().optional(),
  canViewProcurement: z.boolean().optional(),
});

const updateMemberSchema = z.object({
  role: z.enum(["pm", "member"]).optional(),
  canViewProcurement: z.boolean().optional(),
  displayName: z.string().max(255).nullable().optional(),
  externalRef: z.string().max(255).nullable().optional(),
  supplierInfo: z.string().nullable().optional(),
  userId: z.string().min(1).nullable().optional(),
}).refine(
  v => Object.values(v).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

function actorId(c: Context<AppEnv>): string {
  return c.get("user")!.id;
}

/**
 * Resolve the project id from the `:id` short id and assert the actor is at
 * least a member (or a pm when `pm` is required). Fail-closed: a missing
 * project or a non-member both surface as 404 so membership is not leaked.
 */
async function requireProjectAccess(
  c: Context<AppEnv>,
  shortId: string,
  needPm: boolean,
): Promise<string> {
  const db = c.get("db");
  const projectId = await resolveProjectId(db, shortId);
  if (!projectId)
    throw new NotFoundError("Project", shortId);
  const role = await getRole(db, projectId, actorId(c));
  if (role === null)
    throw new NotFoundError("Project", shortId);
  if (needPm && role !== "pm")
    throw new ForbiddenError("Project manager access required");
  return projectId;
}

export function projectRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  // GET /projects — list. Admins see all; others see only projects they belong to.
  router.get("/projects", async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const query = listSchema.parse({
      status: c.req.query("status"),
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });
    const result = await listProjects(db, {
      ...query,
      memberUserId: user.role === "admin" ? undefined : user.id,
    });
    return c.json({
      success: true,
      data: result.data.map(composeProject),
      meta: { total: result.total, page: query.page ?? 1, limit: query.limit ?? 20 },
    });
  });

  // POST /projects — create (admin only); creator becomes the pm member
  router.post("/projects", adminRequired, async (c) => {
    const db = c.get("db");
    const body = createProjectSchema.parse(await c.req.json());
    const project = await createProject(db, { ...body, creatorId: actorId(c) });
    return c.json({ success: true, data: composeProject(project) }, 201);
  });

  // GET /projects/:id — detail (any member)
  router.get("/projects/:id", async (c) => {
    const shortId = c.req.param("id");
    await requireProjectAccess(c, shortId, false);
    const db = c.get("db");
    const project = await getProjectByShortId(db, shortId);
    if (!project)
      throw new NotFoundError("Project", shortId);
    return c.json({ success: true, data: composeProject(project) });
  });

  // PATCH /projects/:id — update (pm only)
  router.patch("/projects/:id", async (c) => {
    const shortId = c.req.param("id");
    await requireProjectAccess(c, shortId, true);
    const db = c.get("db");
    const body = updateProjectSchema.parse(await c.req.json());
    const updated = await updateProject(db, shortId, body);
    if (!updated)
      throw new NotFoundError("Project", shortId);
    return c.json({ success: true, data: composeProject(updated) });
  });

  // DELETE /projects/:id — soft delete (pm only)
  router.delete("/projects/:id", async (c) => {
    const shortId = c.req.param("id");
    await requireProjectAccess(c, shortId, true);
    const db = c.get("db");
    await softDeleteProject(db, shortId);
    return c.json({ success: true, data: null });
  });

  // GET /projects/:id/members — list members (any member)
  router.get("/projects/:id/members", async (c) => {
    const projectId = await requireProjectAccess(c, c.req.param("id"), false);
    const db = c.get("db");
    const members = await listMembers(db, projectId);
    return c.json({ success: true, data: members.map(composeMember) });
  });

  // POST /projects/:id/members — add member (pm only)
  router.post("/projects/:id/members", async (c) => {
    const projectId = await requireProjectAccess(c, c.req.param("id"), true);
    const db = c.get("db");
    const body = addMemberSchema.parse(await c.req.json());
    const member = await addMember(db, projectId, body);
    return c.json({ success: true, data: composeMember(member) }, 201);
  });

  // PATCH /projects/:id/members/:memberId — update member (pm only)
  router.patch("/projects/:id/members/:memberId", async (c) => {
    const projectId = await requireProjectAccess(c, c.req.param("id"), true);
    const db = c.get("db");
    const memberId = c.req.param("memberId");
    const body = updateMemberSchema.parse(await c.req.json());
    const member = await updateMember(db, projectId, memberId, body);
    if (!member)
      throw new NotFoundError("Project member", memberId);
    return c.json({ success: true, data: composeMember(member) });
  });

  // DELETE /projects/:id/members/:memberId — remove member (pm only)
  router.delete("/projects/:id/members/:memberId", async (c) => {
    const projectId = await requireProjectAccess(c, c.req.param("id"), true);
    const db = c.get("db");
    const memberId = c.req.param("memberId");
    const removed = await removeMember(db, projectId, memberId);
    if (!removed)
      throw new NotFoundError("Project member", memberId);
    return c.json({ success: true, data: null });
  });

  return router;
}
