import type { Context } from "hono";
import type { ProjectCapability } from "./schema";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import {
  composeCategory,
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "./project.categories";
import {
  composeGlobalCategory,
  createGlobalCategory,
  deleteGlobalCategory,
  listGlobalCategories,
  updateGlobalCategory,
} from "./project.global-categories";
import {
  composeRole,
  createRole,
  deleteRole,
  listRoles,
  resolveRole,
  updateRole,
} from "./project.roles";
import {
  addMember,
  composeMember,
  composeProjectWithTags,
  createProject,
  getDefaultProjectCover,
  getMemberCapabilities,
  getProjectByShortId,
  listMembers,
  listProjects,
  removeDefaultProjectCover,
  removeMember,
  removeProjectCover,
  resolveProjectId,
  setDefaultProjectCover,
  setProjectCover,
  softDeleteProject,
  updateMember,
  updateProject,
} from "./project.service";
import { PROJECT_CAPABILITIES, PROJECT_STATUSES } from "./schema";

const tagsShape = { tags: z.array(z.string().min(1).max(50)).max(50).optional() };

const createProjectSchema = z.object({
  code: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255),
  status: z.enum(PROJECT_STATUSES).optional(),
  description: z.string().max(2000).nullable().optional(),
  ...tagsShape,
});

const updateProjectSchema = z.object({
  code: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  description: z.string().max(2000).nullable().optional(),
  ...tagsShape,
}).refine(
  v => Object.values(v).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

const listSchema = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  tagId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const addMemberSchema = z.object({
  roleId: z.string().min(1),
  userId: z.string().min(1).nullable().optional(),
  displayName: z.string().max(255).nullable().optional(),
  title: z.string().max(100).nullable().optional(),
}).refine(
  v => (v.userId != null && v.userId !== "") || (v.displayName != null && v.displayName.trim() !== ""),
  { message: "A member needs a userId (real) or a displayName (virtual)" },
);

const updateMemberSchema = z.object({
  roleId: z.string().min(1).optional(),
  displayName: z.string().max(255).nullable().optional(),
  title: z.string().max(100).nullable().optional(),
  userId: z.string().min(1).nullable().optional(),
}).refine(
  v => Object.values(v).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

const capabilitiesSchema = z.array(z.enum(PROJECT_CAPABILITIES)).max(PROJECT_CAPABILITIES.length);

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  capabilities: capabilitiesSchema.optional(),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  capabilities: capabilitiesSchema.optional(),
}).refine(v => Object.values(v).some(value => value !== undefined), { message: "At least one field must be provided" });

const createGlobalCategorySchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
});

const updateGlobalCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
}).refine(v => Object.values(v).some(value => value !== undefined), { message: "At least one field must be provided" });

const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
}).refine(v => Object.values(v).some(value => value !== undefined), { message: "At least one field must be provided" });

function actorId(c: Context<AppEnv>): string {
  return c.get("user")!.id;
}

interface ProjectAccess {
  readonly projectId: string;
  readonly capabilities: ReadonlySet<ProjectCapability>;
}

/**
 * Resolve the project id from the `:id` short id and assert the actor is a
 * member (and, when `capability` is given, that their role grants it). App
 * admins bypass membership with the full capability set. Fail-closed: a
 * missing project or non-member both surface as 404 so membership is not leaked.
 */
async function requireProject(
  c: Context<AppEnv>,
  shortId: string,
  capability?: ProjectCapability,
): Promise<ProjectAccess> {
  const db = c.get("db");
  const projectId = await resolveProjectId(db, shortId);
  if (!projectId)
    throw new NotFoundError("Project", shortId);
  if (c.get("user")!.role === "admin")
    return { projectId, capabilities: new Set(PROJECT_CAPABILITIES) };
  const caps = await getMemberCapabilities(db, projectId, actorId(c));
  if (caps === null)
    throw new NotFoundError("Project", shortId);
  if (capability && !caps.has(capability))
    throw new ForbiddenError(`Capability '${capability}' required`);
  return { projectId, capabilities: caps };
}

export function projectRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  // ─── Global procurement categories (admin only) ────────────────────
  // The template set copied into each new project at creation (copy-on-create).
  router.get("/global-procurement-categories", adminRequired, async (c) => {
    const db = c.get("db");
    return c.json({ success: true, data: (await listGlobalCategories(db)).map(composeGlobalCategory) });
  });

  router.post("/global-procurement-categories", adminRequired, async (c) => {
    const db = c.get("db");
    const body = createGlobalCategorySchema.parse(await c.req.json());
    const category = await createGlobalCategory(db, body);
    return c.json({ success: true, data: composeGlobalCategory(category) }, 201);
  });

  router.patch("/global-procurement-categories/:id", adminRequired, async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const body = updateGlobalCategorySchema.parse(await c.req.json());
    const category = await updateGlobalCategory(db, id, body);
    if (!category)
      throw new NotFoundError("Global procurement category", id);
    return c.json({ success: true, data: composeGlobalCategory(category) });
  });

  router.delete("/global-procurement-categories/:id", adminRequired, async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    if (!await deleteGlobalCategory(db, id))
      throw new NotFoundError("Global procurement category", id);
    return c.json({ success: true, data: null });
  });

  // ─── Global default project cover (admin only) ────────────────────
  // Backs the admin "Project Defaults" cover picker. The reference id is
  // stored in PROJECT_DEFAULT_COVER_KEY, which project create-seeding reads
  // to apply this cover to new projects. A distinct owner_type
  // ("project_cover_default") keeps it separate from per-project covers.

  // GET — preview the current default cover (nulls when unset).
  router.get("/admin/project-default-cover", adminRequired, async (c) => {
    const db = c.get("db");
    return c.json({ success: true, data: await getDefaultProjectCover(db) });
  });

  // POST (multipart `file`) — upload / replace the default cover.
  router.post("/admin/project-default-cover", adminRequired, async (c) => {
    const db = c.get("db");
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File))
      throw new AppError("No file provided", 400, "VALIDATION_ERROR");
    if (!file.type.startsWith("image/"))
      throw new AppError("Cover image must be an image file", 400, "INVALID_MIMETYPE");
    const result = await setDefaultProjectCover(db, c.get("config"), file, actorId(c));
    return c.json({ success: true, data: result });
  });

  // DELETE — release + clear the default cover (idempotent).
  router.delete("/admin/project-default-cover", adminRequired, async (c) => {
    const db = c.get("db");
    await removeDefaultProjectCover(db, c.get("config"));
    return c.json({ success: true, data: null });
  });

  // GET /projects — list. Admins see all; others see only projects they belong to.
  router.get("/projects", async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const query = listSchema.parse({
      status: c.req.query("status"),
      tagId: c.req.query("tagId"),
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });
    const result = await listProjects(db, {
      ...query,
      // Archived projects are hidden unless explicitly requested via the
      // `status=archived` filter (the "Archived" chip on the list).
      excludeArchived: query.status === undefined,
      memberUserId: user.role === "admin" ? undefined : user.id,
    });
    return c.json({
      success: true,
      data: result.data,
      meta: { total: result.total, page: query.page ?? 1, limit: query.limit ?? 20 },
    });
  });

  // POST /projects — create (admin only); creator becomes the pm member
  router.post("/projects", adminRequired, async (c) => {
    const db = c.get("db");
    const body = createProjectSchema.parse(await c.req.json());
    const project = await createProject(db, { ...body, creatorId: actorId(c) });
    return c.json({ success: true, data: await composeProjectWithTags(db, project) }, 201);
  });

  // GET /projects/:id — detail (any member); response carries caller capabilities
  router.get("/projects/:id", async (c) => {
    const shortId = c.req.param("id");
    const { capabilities } = await requireProject(c, shortId);
    const db = c.get("db");
    const project = await getProjectByShortId(db, shortId);
    if (!project)
      throw new NotFoundError("Project", shortId);
    const view = await composeProjectWithTags(db, project);
    return c.json({ success: true, data: { ...view, capabilities: [...capabilities] } });
  });

  // PATCH /projects/:id — update (project.manage)
  router.patch("/projects/:id", async (c) => {
    const shortId = c.req.param("id");
    await requireProject(c, shortId, "project.manage");
    const db = c.get("db");
    const body = updateProjectSchema.parse(await c.req.json());
    const updated = await updateProject(db, shortId, body);
    if (!updated)
      throw new NotFoundError("Project", shortId);
    return c.json({ success: true, data: await composeProjectWithTags(db, updated) });
  });

  // DELETE /projects/:id — soft delete (project.manage)
  router.delete("/projects/:id", async (c) => {
    const shortId = c.req.param("id");
    await requireProject(c, shortId, "project.manage");
    const db = c.get("db");
    await softDeleteProject(db, shortId);
    return c.json({ success: true, data: null });
  });

  // POST /projects/:id/cover-image — set / replace the cover (project.manage)
  router.post("/projects/:id/cover-image", async (c) => {
    const shortId = c.req.param("id");
    const { projectId } = await requireProject(c, shortId, "project.manage");
    const db = c.get("db");

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File))
      throw new AppError("No file provided", 400, "VALIDATION_ERROR");
    if (!file.type.startsWith("image/"))
      throw new AppError("Cover image must be an image file", 400, "INVALID_MIMETYPE");

    const updated = await setProjectCover(db, c.get("config"), projectId, file, actorId(c));
    if (!updated)
      throw new NotFoundError("Project", shortId);
    return c.json({ success: true, data: await composeProjectWithTags(db, updated) });
  });

  // DELETE /projects/:id/cover-image — remove the cover (project.manage)
  router.delete("/projects/:id/cover-image", async (c) => {
    const shortId = c.req.param("id");
    const { projectId } = await requireProject(c, shortId, "project.manage");
    const db = c.get("db");
    const updated = await removeProjectCover(db, c.get("config"), projectId);
    if (!updated)
      throw new NotFoundError("Project", shortId);
    return c.json({ success: true, data: await composeProjectWithTags(db, updated) });
  });

  // ─── Members ───────────────────────────────────────────────────────
  router.get("/projects/:id/members", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"));
    const db = c.get("db");
    const members = await listMembers(db, projectId);
    return c.json({ success: true, data: members.map(composeMember) });
  });

  router.post("/projects/:id/members", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"), "members.manage");
    const db = c.get("db");
    const body = addMemberSchema.parse(await c.req.json());
    if (!await resolveRole(db, projectId, body.roleId))
      throw new ValidationError("Role does not belong to this project", { roleId: "Unknown role" });
    const member = await addMember(db, projectId, body);
    return c.json({ success: true, data: composeMember(member) }, 201);
  });

  router.patch("/projects/:id/members/:memberId", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"), "members.manage");
    const db = c.get("db");
    const body = updateMemberSchema.parse(await c.req.json());
    if (body.roleId !== undefined && !await resolveRole(db, projectId, body.roleId))
      throw new ValidationError("Role does not belong to this project", { roleId: "Unknown role" });
    const member = await updateMember(db, projectId, c.req.param("memberId"), body);
    if (!member)
      throw new NotFoundError("Project member", c.req.param("memberId"));
    return c.json({ success: true, data: composeMember(member) });
  });

  router.delete("/projects/:id/members/:memberId", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"), "members.manage");
    const db = c.get("db");
    const removed = await removeMember(db, projectId, c.req.param("memberId"));
    if (!removed)
      throw new NotFoundError("Project member", c.req.param("memberId"));
    return c.json({ success: true, data: null });
  });

  // ─── Roles ─────────────────────────────────────────────────────────
  router.get("/projects/:id/roles", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"));
    const db = c.get("db");
    return c.json({ success: true, data: (await listRoles(db, projectId)).map(composeRole) });
  });

  router.post("/projects/:id/roles", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"), "roles.manage");
    const db = c.get("db");
    const body = createRoleSchema.parse(await c.req.json());
    const role = await createRole(db, projectId, body);
    return c.json({ success: true, data: composeRole(role) }, 201);
  });

  router.patch("/projects/:id/roles/:roleId", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"), "roles.manage");
    const db = c.get("db");
    const body = updateRoleSchema.parse(await c.req.json());
    const role = await updateRole(db, projectId, c.req.param("roleId"), body);
    if (!role)
      throw new NotFoundError("Project role", c.req.param("roleId"));
    return c.json({ success: true, data: composeRole(role) });
  });

  router.delete("/projects/:id/roles/:roleId", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"), "roles.manage");
    const db = c.get("db");
    const result = await deleteRole(db, projectId, c.req.param("roleId"));
    if (result === "not_found")
      throw new NotFoundError("Project role", c.req.param("roleId"));
    if (result === "system")
      throw new ForbiddenError("System roles cannot be deleted");
    if (result === "in_use")
      throw new ValidationError("Role is still assigned to members", { roleId: "Role in use" });
    return c.json({ success: true, data: null });
  });

  // ─── Procurement categories ────────────────────────────────────────
  router.get("/projects/:id/procurement-categories", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"));
    const db = c.get("db");
    return c.json({ success: true, data: (await listCategories(db, projectId)).map(composeCategory) });
  });

  router.post("/projects/:id/procurement-categories", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"), "categories.manage");
    const db = c.get("db");
    const body = createCategorySchema.parse(await c.req.json());
    const category = await createCategory(db, projectId, body);
    return c.json({ success: true, data: composeCategory(category) }, 201);
  });

  router.patch("/projects/:id/procurement-categories/:categoryId", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"), "categories.manage");
    const db = c.get("db");
    const body = updateCategorySchema.parse(await c.req.json());
    const category = await updateCategory(db, projectId, c.req.param("categoryId"), body);
    if (!category)
      throw new NotFoundError("Procurement category", c.req.param("categoryId"));
    return c.json({ success: true, data: composeCategory(category) });
  });

  router.delete("/projects/:id/procurement-categories/:categoryId", async (c) => {
    const { projectId } = await requireProject(c, c.req.param("id"), "categories.manage");
    const db = c.get("db");
    const removed = await deleteCategory(db, projectId, c.req.param("categoryId"));
    if (!removed)
      throw new NotFoundError("Procurement category", c.req.param("categoryId"));
    return c.json({ success: true, data: null });
  });

  return router;
}
