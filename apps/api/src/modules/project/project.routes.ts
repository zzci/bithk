import type { Context } from "hono";
import type { ProjectCapability } from "./schema";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, okListJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { optionalPageQueryFields } from "@/shared/lib/pagination";
import { parseTagIds } from "@/shared/lib/route-params";
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
  isProjectVersionConflict,
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
  description: z.string().max(2000).nullable().optional(),
  ...tagsShape,
});

const updateProjectSchema = z.object({
  // `code` is immutable after creation — update requests cannot carry it.
  name: z.string().min(1).max(255).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  description: z.string().max(2000).nullable().optional(),
  // Optional optimistic-concurrency guard; not a mutable field, so it is
  // excluded from the "at least one field" check below.
  expectedVersion: z.number().int().nonnegative().optional(),
  ...tagsShape,
}).refine(
  ({ expectedVersion, ...fields }) => Object.values(fields).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

const listSchema = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  q: z.string().min(1).max(200).optional(),
  ...optionalPageQueryFields(100),
});

const addMemberSchema = z.object({
  roleId: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().max(100).nullable().optional(),
});

const updateMemberSchema = z.object({
  roleId: z.string().min(1).optional(),
  title: z.string().max(100).nullable().optional(),
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

// Multipart upload (`file` field) request-body doc for cover-image uploads.
const fileUploadBody = { content: { "multipart/form-data": { schema: { type: "object" as const, properties: { file: { type: "string" as const, format: "binary" } } } } } };

const idParam = z.object({ id: z.string() });
const memberParam = z.object({ id: z.string(), memberId: z.string() });
const roleParam = z.object({ id: z.string(), roleId: z.string() });
const categoryParam = z.object({ id: z.string(), categoryId: z.string() });

// Response `data` schemas mirroring the project service view composers.
// Tags carry the type-wide `usageCount` (`ProjectTagView` / the shared
// `ResourceTagUsageView`), matching the ship module's bound-project rows.
const projectTagSchema = z.object({ id: z.string(), name: z.string(), usageCount: z.number() });
const projectViewSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  status: z.enum(PROJECT_STATUSES),
  description: z.string().nullable(),
  shipId: z.string().nullable(),
  tags: z.array(projectTagSchema),
  coverImageUrl: z.string().nullable(),
  creatorId: z.string(),
  version: z.number(),
  updatedAt: z.string(),
});
// Detail additionally carries the caller's capabilities.
const projectDetailSchema = projectViewSchema.extend({ capabilities: z.array(z.enum(PROJECT_CAPABILITIES)) });
const memberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  isVirtual: z.boolean(),
  roleId: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  capabilities: z.array(z.enum(PROJECT_CAPABILITIES)),
  isSystem: z.boolean(),
  kind: z.enum(["owner", "guest"]).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
// Shared shape for project + global procurement categories.
const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const defaultCoverSchema = z.object({ referenceId: z.string().nullable(), url: z.string().nullable() });

function actorId(c: Context<ProtectedEnv>): string {
  return c.get("user").id;
}

/**
 * Gate which roles a member endpoint may assign, given the caller's own
 * capabilities (F1). Two rules, both anti-escalation:
 *   - The Guest role is never assignable through the member endpoints; it is
 *     reached solely via the delete-fallback path.
 *   - The Owner role (the `kind='owner'`, owner-defining role) is assignable
 *     only by a caller who already holds `project.manage` — i.e. an existing
 *     owner or an app admin. This supports multiple owners while ensuring a
 *     `members.manage`-only delegate cannot promote anyone (themselves
 *     included) to full ownership.
 * Every other role (Reader / Commenter / Writer, `kind=null`) is assignable.
 */
function assertAssignableRole(
  role: { isSystem: number; kind: "owner" | "guest" | null },
  callerCaps: ReadonlySet<ProjectCapability>,
): void {
  if (role.kind === "guest")
    throw new ForbiddenError("The Guest role cannot be assigned to members");
  if (role.kind === "owner" && !callerCaps.has("project.manage"))
    throw new ForbiddenError("Only an owner can assign the Owner role");
}

/**
 * Bound a capability grant to the caller's own capabilities (F2): a holder of
 * `roles.manage` cannot create or edit a role to include a capability they do
 * not themselves hold. This prevents privilege amplification (e.g. granting
 * `project.manage` / `members.manage` to a role and then assuming it). App
 * admins and Owners hold the full capability set, so legitimate flows are
 * unaffected.
 */
function assertGrantWithinCaps(
  granter: ReadonlySet<ProjectCapability>,
  requested: readonly ProjectCapability[] | undefined,
): void {
  if (!requested)
    return;
  const over = requested.filter(cap => !granter.has(cap));
  if (over.length > 0)
    throw new ForbiddenError(`Cannot grant capabilities you do not hold: ${over.join(", ")}`);
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
  c: Context<ProtectedEnv>,
  shortId: string,
  capability?: ProjectCapability,
): Promise<ProjectAccess> {
  const db = c.get("db");
  const projectId = await resolveProjectId(db, shortId);
  if (!projectId)
    throw new NotFoundError("Project", shortId);
  if (c.get("user").role === "admin")
    return { projectId, capabilities: new Set(PROJECT_CAPABILITIES) };
  const caps = await getMemberCapabilities(db, projectId, actorId(c));
  if (caps === null)
    throw new NotFoundError("Project", shortId);
  if (capability && !caps.has(capability))
    throw new ForbiddenError(`Capability '${capability}' required`);
  return { projectId, capabilities: caps };
}

export function projectRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // ─── Global procurement categories (admin only) ────────────────────
  // The template set copied into each new project at creation (copy-on-create).
  router.get(
    "/global-procurement-categories",
    describeRoute({
      tags: ["projects"],
      summary: "List global procurement categories",
      responses: {
        200: okJson(z.array(categorySchema)),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      return c.json({ success: true, data: (await listGlobalCategories(db)).map(composeGlobalCategory) });
    },
  );

  router.post(
    "/global-procurement-categories",
    describeRoute({
      tags: ["projects"],
      summary: "Create a global procurement category",
      responses: {
        201: okJson(categorySchema, "Created"),
        403: { description: "Admin only", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("json", createGlobalCategorySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const category = await createGlobalCategory(db, body);
      return c.json({ success: true, data: composeGlobalCategory(category) }, 201);
    },
  );

  router.patch(
    "/global-procurement-categories/:id",
    describeRoute({
      tags: ["projects"],
      summary: "Update a global procurement category",
      responses: {
        200: okJson(categorySchema),
        403: { description: "Admin only", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", idParam, onValidationFailure),
    validator("json", updateGlobalCategorySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const category = await updateGlobalCategory(db, id, body);
      if (!category)
        throw new NotFoundError("Global procurement category", id);
      return c.json({ success: true, data: composeGlobalCategory(category) });
    },
  );

  router.delete(
    "/global-procurement-categories/:id",
    describeRoute({
      tags: ["projects"],
      summary: "Delete a global procurement category",
      responses: {
        200: okJson(z.null()),
        403: { description: "Admin only", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      if (!await deleteGlobalCategory(db, id))
        throw new NotFoundError("Global procurement category", id);
      return c.json({ success: true, data: null });
    },
  );

  // ─── Global default project cover (admin only) ────────────────────
  // Backs the admin "Project Defaults" cover picker. The reference id is
  // stored in PROJECT_DEFAULT_COVER_KEY, which project create-seeding reads
  // to apply this cover to new projects. A distinct owner_type
  // ("project_cover_default") keeps it separate from per-project covers.

  // GET — preview the current default cover (nulls when unset).
  router.get(
    "/admin/project-default-cover",
    describeRoute({
      tags: ["projects"],
      summary: "Get the default project cover",
      responses: {
        200: okJson(defaultCoverSchema),
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      return c.json({ success: true, data: await getDefaultProjectCover(db) });
    },
  );

  // POST (multipart `file`) — upload / replace the default cover.
  router.post(
    "/admin/project-default-cover",
    describeRoute({
      tags: ["projects"],
      summary: "Upload / replace the default project cover",
      requestBody: fileUploadBody,
      responses: {
        200: okJson(defaultCoverSchema),
        400: { description: "No file provided", ...errorJson },
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!(file instanceof File))
        throw new AppError("No file provided", 400, "VALIDATION_ERROR");
      const result = await setDefaultProjectCover(db, c.get("config"), file, actorId(c));
      return c.json({ success: true, data: result });
    },
  );

  // DELETE — release + clear the default cover (idempotent).
  router.delete(
    "/admin/project-default-cover",
    describeRoute({
      tags: ["projects"],
      summary: "Clear the default project cover",
      responses: {
        200: okJson(z.null()),
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      await removeDefaultProjectCover(db, c.get("config"));
      return c.json({ success: true, data: null });
    },
  );

  // GET /projects — list. Admins see all; others see only projects they belong to.
  router.get(
    "/projects",
    describeRoute({
      tags: ["projects"],
      summary: "List projects",
      responses: {
        200: okListJson(projectViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("query", listSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const query = c.req.valid("query");
      const tagIds = parseTagIds(c.req.queries("tagIds"));
      const result = await listProjects(db, {
        ...query,
        tagIds,
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
    },
  );

  // POST /projects — create (admin only); creator becomes the pm member
  router.post(
    "/projects",
    describeRoute({
      tags: ["projects"],
      summary: "Create a project",
      responses: {
        201: okJson(projectViewSchema, "Created"),
        403: { description: "Admin only", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("json", createProjectSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const project = await createProject(db, { ...body, creatorId: actorId(c) });
      return c.json({ success: true, data: await composeProjectWithTags(db, project) }, 201);
    },
  );

  // GET /projects/:id — detail (any member); response carries caller capabilities
  router.get(
    "/projects/:id",
    describeRoute({
      tags: ["projects"],
      summary: "Get a project",
      responses: {
        200: okJson(projectDetailSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const shortId = c.req.valid("param").id;
      const { capabilities } = await requireProject(c, shortId);
      const db = c.get("db");
      const project = await getProjectByShortId(db, shortId);
      if (!project)
        throw new NotFoundError("Project", shortId);
      const view = await composeProjectWithTags(db, project);
      return c.json({ success: true, data: { ...view, capabilities: [...capabilities] } });
    },
  );

  // PATCH /projects/:id — update (project.manage)
  router.patch(
    "/projects/:id",
    describeRoute({
      tags: ["projects"],
      summary: "Update a project",
      responses: {
        200: okJson(projectViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
        409: { description: "Version conflict", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    validator("json", updateProjectSchema, onValidationFailure),
    async (c) => {
      const shortId = c.req.valid("param").id;
      await requireProject(c, shortId, "project.manage");
      const db = c.get("db");
      const body = c.req.valid("json");
      const updated = await updateProject(db, shortId, body);
      if (!updated)
        throw new NotFoundError("Project", shortId);
      if (isProjectVersionConflict(updated)) {
        return c.json(
          { success: false, error: { code: "VERSION_CONFLICT", message: "Project was modified by another editor" }, data: updated.current },
          409,
        );
      }
      return c.json({ success: true, data: await composeProjectWithTags(db, updated) });
    },
  );

  // DELETE /projects/:id — soft delete (project.manage)
  router.delete(
    "/projects/:id",
    describeRoute({
      tags: ["projects"],
      summary: "Delete a project",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const shortId = c.req.valid("param").id;
      await requireProject(c, shortId, "project.manage");
      const db = c.get("db");
      await softDeleteProject(db, shortId);
      return c.json({ success: true, data: null });
    },
  );

  // POST /projects/:id/cover-image — set / replace the cover (project.manage)
  router.post(
    "/projects/:id/cover-image",
    describeRoute({
      tags: ["projects"],
      summary: "Set / replace a project cover image",
      requestBody: fileUploadBody,
      responses: {
        200: okJson(projectViewSchema),
        400: { description: "No file provided", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const shortId = c.req.valid("param").id;
      const { projectId } = await requireProject(c, shortId, "project.manage");
      const db = c.get("db");

      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!(file instanceof File))
        throw new AppError("No file provided", 400, "VALIDATION_ERROR");

      const updated = await setProjectCover(db, c.get("config"), projectId, file, actorId(c));
      if (!updated)
        throw new NotFoundError("Project", shortId);
      return c.json({ success: true, data: await composeProjectWithTags(db, updated) });
    },
  );

  // DELETE /projects/:id/cover-image — remove the cover (project.manage)
  router.delete(
    "/projects/:id/cover-image",
    describeRoute({
      tags: ["projects"],
      summary: "Remove a project cover image",
      responses: {
        200: okJson(projectViewSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const shortId = c.req.valid("param").id;
      const { projectId } = await requireProject(c, shortId, "project.manage");
      const db = c.get("db");
      const updated = await removeProjectCover(db, c.get("config"), projectId);
      if (!updated)
        throw new NotFoundError("Project", shortId);
      return c.json({ success: true, data: await composeProjectWithTags(db, updated) });
    },
  );

  // ─── Members ───────────────────────────────────────────────────────
  router.get(
    "/projects/:id/members",
    describeRoute({
      tags: ["projects"],
      summary: "List project members",
      responses: {
        200: okJson(z.array(memberSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const { projectId } = await requireProject(c, c.req.valid("param").id);
      const db = c.get("db");
      const members = await listMembers(db, projectId);
      return c.json({ success: true, data: members.map(composeMember) });
    },
  );

  router.post(
    "/projects/:id/members",
    describeRoute({
      tags: ["projects"],
      summary: "Add a project member",
      responses: {
        201: okJson(memberSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    validator("json", addMemberSchema, onValidationFailure),
    async (c) => {
      const { projectId, capabilities } = await requireProject(c, c.req.valid("param").id, "members.manage");
      const db = c.get("db");
      const body = c.req.valid("json");
      const role = await resolveRole(db, projectId, body.roleId);
      if (!role)
        throw new ValidationError("Role does not belong to this project", { roleId: "Unknown role" });
      assertAssignableRole(role, capabilities);
      const member = await addMember(db, projectId, body);
      return c.json({ success: true, data: composeMember(member) }, 201);
    },
  );

  router.patch(
    "/projects/:id/members/:memberId",
    describeRoute({
      tags: ["projects"],
      summary: "Update a project member",
      responses: {
        200: okJson(memberSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Project member not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", memberParam, onValidationFailure),
    validator("json", updateMemberSchema, onValidationFailure),
    async (c) => {
      const { id, memberId } = c.req.valid("param");
      const { projectId, capabilities } = await requireProject(c, id, "members.manage");
      const db = c.get("db");
      const body = c.req.valid("json");
      if (body.roleId !== undefined) {
        const role = await resolveRole(db, projectId, body.roleId);
        if (!role)
          throw new ValidationError("Role does not belong to this project", { roleId: "Unknown role" });
        assertAssignableRole(role, capabilities);
      }
      const member = await updateMember(db, projectId, memberId, body);
      if (!member)
        throw new NotFoundError("Project member", memberId);
      return c.json({ success: true, data: composeMember(member) });
    },
  );

  router.delete(
    "/projects/:id/members/:memberId",
    describeRoute({
      tags: ["projects"],
      summary: "Remove a project member",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Project member not found", ...errorJson },
      },
    }),
    validator("param", memberParam, onValidationFailure),
    async (c) => {
      const { id, memberId } = c.req.valid("param");
      const { projectId } = await requireProject(c, id, "members.manage");
      const db = c.get("db");
      const removed = await removeMember(db, projectId, memberId);
      if (!removed)
        throw new NotFoundError("Project member", memberId);
      return c.json({ success: true, data: null });
    },
  );

  // ─── Roles ─────────────────────────────────────────────────────────
  router.get(
    "/projects/:id/roles",
    describeRoute({
      tags: ["projects"],
      summary: "List project roles",
      responses: {
        200: okJson(z.array(roleSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const { projectId } = await requireProject(c, c.req.valid("param").id);
      const db = c.get("db");
      return c.json({ success: true, data: (await listRoles(db, projectId)).map(composeRole) });
    },
  );

  router.post(
    "/projects/:id/roles",
    describeRoute({
      tags: ["projects"],
      summary: "Create a project role",
      responses: {
        201: okJson(roleSchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    validator("json", createRoleSchema, onValidationFailure),
    async (c) => {
      const { projectId, capabilities } = await requireProject(c, c.req.valid("param").id, "roles.manage");
      const db = c.get("db");
      const body = c.req.valid("json");
      assertGrantWithinCaps(capabilities, body.capabilities);
      const role = await createRole(db, projectId, body);
      return c.json({ success: true, data: composeRole(role) }, 201);
    },
  );

  router.patch(
    "/projects/:id/roles/:roleId",
    describeRoute({
      tags: ["projects"],
      summary: "Update a project role",
      responses: {
        200: okJson(roleSchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Project role not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", roleParam, onValidationFailure),
    validator("json", updateRoleSchema, onValidationFailure),
    async (c) => {
      const { id, roleId } = c.req.valid("param");
      const { projectId, capabilities } = await requireProject(c, id, "roles.manage");
      const db = c.get("db");
      const body = c.req.valid("json");
      assertGrantWithinCaps(capabilities, body.capabilities);
      const role = await updateRole(db, projectId, roleId, body);
      if (!role)
        throw new NotFoundError("Project role", roleId);
      return c.json({ success: true, data: composeRole(role) });
    },
  );

  router.delete(
    "/projects/:id/roles/:roleId",
    describeRoute({
      tags: ["projects"],
      summary: "Delete a project role",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Project role not found", ...errorJson },
      },
    }),
    validator("param", roleParam, onValidationFailure),
    async (c) => {
      const { id, roleId } = c.req.valid("param");
      const { projectId } = await requireProject(c, id, "roles.manage");
      const db = c.get("db");
      const result = await deleteRole(db, projectId, roleId);
      if (result === "not_found")
        throw new NotFoundError("Project role", roleId);
      if (result === "system")
        throw new ForbiddenError("System roles cannot be deleted");
      return c.json({ success: true, data: null });
    },
  );

  // ─── Procurement categories ────────────────────────────────────────
  router.get(
    "/projects/:id/procurement-categories",
    describeRoute({
      tags: ["projects"],
      summary: "List project procurement categories",
      responses: {
        200: okJson(z.array(categorySchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const { projectId } = await requireProject(c, c.req.valid("param").id);
      const db = c.get("db");
      return c.json({ success: true, data: (await listCategories(db, projectId)).map(composeCategory) });
    },
  );

  router.post(
    "/projects/:id/procurement-categories",
    describeRoute({
      tags: ["projects"],
      summary: "Create a project procurement category",
      responses: {
        201: okJson(categorySchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    validator("json", createCategorySchema, onValidationFailure),
    async (c) => {
      const { projectId } = await requireProject(c, c.req.valid("param").id, "categories.manage");
      const db = c.get("db");
      const body = c.req.valid("json");
      const category = await createCategory(db, projectId, body);
      return c.json({ success: true, data: composeCategory(category) }, 201);
    },
  );

  router.patch(
    "/projects/:id/procurement-categories/:categoryId",
    describeRoute({
      tags: ["projects"],
      summary: "Update a project procurement category",
      responses: {
        200: okJson(categorySchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Procurement category not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", categoryParam, onValidationFailure),
    validator("json", updateCategorySchema, onValidationFailure),
    async (c) => {
      const { id, categoryId } = c.req.valid("param");
      const { projectId } = await requireProject(c, id, "categories.manage");
      const db = c.get("db");
      const body = c.req.valid("json");
      const category = await updateCategory(db, projectId, categoryId, body);
      if (!category)
        throw new NotFoundError("Procurement category", categoryId);
      return c.json({ success: true, data: composeCategory(category) });
    },
  );

  router.delete(
    "/projects/:id/procurement-categories/:categoryId",
    describeRoute({
      tags: ["projects"],
      summary: "Delete a project procurement category",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Procurement category not found", ...errorJson },
      },
    }),
    validator("param", categoryParam, onValidationFailure),
    async (c) => {
      const { id, categoryId } = c.req.valid("param");
      const { projectId } = await requireProject(c, id, "categories.manage");
      const db = c.get("db");
      const removed = await deleteCategory(db, projectId, categoryId);
      if (!removed)
        throw new NotFoundError("Procurement category", categoryId);
      return c.json({ success: true, data: null });
    },
  );

  return router;
}
