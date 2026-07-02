import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { listGroups } from "@/modules/account/groups/groups.service";
import { listUsers } from "@/modules/account/users/users.service";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { getClientIp } from "@/shared/lib/client-ip";
import { NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, okListJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { parsePageQuery } from "@/shared/lib/pagination";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import {
  batchCreateTuples,
  batchDeleteTuples,
  createTuple,
  deleteTuple,
  getTupleById,
  getTuplesBySubject,
  listTuples,
  updateTupleRelation,
} from "./policy.service";
import { getPermissionManifest } from "./registry";
import {
  addResourceGroupMember,
  createResourceGroup,
  deleteResourceGroup,
  getResourceGroupMembers,
  listResourceGroups,
  removeResourceGroupMember,
  updateResourceGroup,
} from "./resource-group.service";
import { getRouteBindingsForResource } from "./route-registry";
import { check, expand } from "./zanzibar.engine";

const tupleSchema = z.object({
  namespace: z.string().min(1),
  objectId: z.string().min(1),
  relation: z.string().min(1),
  subjectNamespace: z.string().min(1),
  subjectId: z.string().min(1),
  subjectRelation: z.string().nullable().optional(),
});

const checkSchema = z.object({
  namespace: z.string().min(1),
  objectId: z.string().min(1),
  relation: z.string().min(1),
  subjectNamespace: z.string().min(1),
  subjectId: z.string().min(1),
});

const expandSchema = z.object({
  namespace: z.string().min(1),
  objectId: z.string().min(1),
  relation: z.string().min(1),
});

const batchSchema = z.object({
  create: z.array(tupleSchema).optional(),
  delete: z.array(z.string()).optional(),
});

const tupleRelationSchema = z.object({ relation: z.string().min(1) });
const resourceGroupBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().default(null),
});
const resourceGroupMemberBodySchema = z.object({
  namespace: z.string().min(1),
  objectId: z.string().min(1),
});

// Pagination/filter query for the tuple list. All fields are optional strings:
// the handler keeps its own page/limit clamping so the normalized bounds stay
// byte-for-byte identical to the previous manual `c.req.query()` parsing.
const listTuplesQuerySchema = z.object({
  namespace: z.string().optional(),
  object_id: z.string().optional(),
  relation: z.string().optional(),
  subject_namespace: z.string().optional(),
  subject_id: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

const idParamSchema = z.object({ id: z.string() });
const memberParamSchema = z.object({ id: z.string(), tupleId: z.string() });

// Response `data` schemas mirroring the real service return shapes (doc only).
const relationTupleSchema = z.object({
  id: z.string(),
  namespace: z.string(),
  objectId: z.string(),
  relation: z.string(),
  subjectNamespace: z.string(),
  subjectId: z.string(),
  subjectRelation: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
const resourceGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
});
const resourceGroupMemberSchema = z.object({
  tupleId: z.string(),
  namespace: z.string(),
  objectId: z.string(),
});
const checkResultSchema = z.object({
  allowed: z.boolean(),
  resolvedThrough: z.array(z.string()),
});
const subjectNodeSchema = z.object({
  namespace: z.string(),
  id: z.string(),
  relation: z.string().optional(),
  get children() {
    return z.array(subjectNodeSchema).optional();
  },
});
const manifestEntrySchema = z.object({
  name: z.string(),
  namespace: z.string(),
  description: z.string().optional(),
  actions: z.array(z.object({ action: z.string(), relation: z.string() })),
  hooks: z.array(z.string()),
  routes: z.array(z.object({ method: z.string(), path: z.string(), action: z.string() })),
});
const entityRefSchema = z.object({ id: z.string(), name: z.string() });
const entitiesSchema = z.object({
  user: z.array(entityRefSchema),
  group: z.array(entityRefSchema),
  resource_group: z.array(entityRefSchema),
});
const batchResultSchema = z.object({
  created: z.array(relationTupleSchema),
  deletedCount: z.number(),
});

const authError = { description: "Unauthenticated", ...errorJson };
const adminError = { description: "Admin only", ...errorJson };
const notFoundError = { description: "Not found", ...errorJson };
const validationError = { description: "Validation error", ...errorJson };

export function policyRoutes() {
  const router = new Hono<ProtectedEnv>();

  // GET /policy/tuples — list relation tuples (admin)
  router.get(
    "/policy/tuples",
    describeRoute({
      tags: ["policy"],
      summary: "List relation tuples",
      responses: {
        200: okListJson(relationTupleSchema, "Paginated relation tuples"),
        401: authError,
        403: adminError,
      },
    }),
    authRequired,
    adminRequired,
    validator("query", listTuplesQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const query = c.req.valid("query");

      const { page, limit } = parsePageQuery(c, { limit: 50 });

      const result = await listTuples(db, {
        namespace: query.namespace,
        objectId: query.object_id,
        relation: query.relation,
        subjectNamespace: query.subject_namespace,
        subjectId: query.subject_id,
        page,
        limit,
      });

      return c.json({
        success: true,
        data: result.data,
        meta: { total: result.total, page, limit },
      });
    },
  );

  // POST /policy/tuples — create relation tuple (admin)
  router.post(
    "/policy/tuples",
    describeRoute({
      tags: ["policy"],
      summary: "Create a relation tuple",
      responses: { 201: okJson(relationTupleSchema, "Created"), 401: authError, 403: adminError, 422: validationError },
    }),
    authRequired,
    adminRequired,
    validator("json", tupleSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const body = c.req.valid("json");

      // Auto-fill subjectRelation for group subjects
      const tupleInput = {
        ...body,
        subjectRelation: body.subjectNamespace === "group" && !body.subjectRelation ? "member" : body.subjectRelation,
      };

      const tuple = await createTuple(db, tupleInput, user.id);

      const tupleStr = `${tupleInput.namespace}:${tupleInput.objectId}#${tupleInput.relation}@${tupleInput.subjectNamespace}:${tupleInput.subjectId}${tupleInput.subjectRelation ? `#${tupleInput.subjectRelation}` : ""}`;
      await auditFromCtx(c, {
        action: "tuple.created",
        resourceType: body.namespace,
        resourceId: body.objectId,
        resourceName: tupleStr,
        detail: { tuple: tupleStr, ...body },
        result: "success",
      });
      return c.json({ success: true, data: tuple }, 201);
    },
  );

  // DELETE /policy/tuples/:id — delete relation tuple (admin)
  router.delete(
    "/policy/tuples/:id",
    describeRoute({
      tags: ["policy"],
      summary: "Delete a relation tuple",
      responses: { 200: okJson(z.null()), 401: authError, 403: adminError, 404: notFoundError },
    }),
    authRequired,
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");

      const existing = await getTupleById(db, id);
      const deleted = await deleteTuple(db, id);
      if (!deleted) {
        throw new NotFoundError("Tuple", id);
      }

      if (existing) {
        await auditFromCtx(c, {
          action: "tuple.deleted",
          resourceType: existing.namespace,
          resourceId: existing.objectId,
          resourceName: id,
          result: "success",
        });
      }
      return c.json({ success: true, data: null });
    },
  );

  // PATCH /policy/tuples/:id — update relation tuple (admin)
  router.patch(
    "/policy/tuples/:id",
    describeRoute({
      tags: ["policy"],
      summary: "Update a relation tuple's relation",
      responses: { 200: okJson(relationTupleSchema), 401: authError, 403: adminError, 404: notFoundError, 422: validationError },
    }),
    authRequired,
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    validator("json", tupleRelationSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id } = c.req.valid("param");

      const existing = await getTupleById(db, id);
      if (!existing) {
        throw new NotFoundError("Tuple", id);
      }

      const body = c.req.valid("json");

      // Delete old and create new with updated relation atomically: a failed
      // validation / duplicate check rolls back, so the existing grant is never
      // destroyed by a partial write (FIX-AUDIT-017).
      const updated = await updateTupleRelation(db, id, {
        namespace: existing.namespace,
        objectId: existing.objectId,
        relation: body.relation,
        subjectNamespace: existing.subjectNamespace,
        subjectId: existing.subjectId,
        subjectRelation: existing.subjectRelation,
      }, user.id);

      const tupleStr = `${existing.namespace}:${existing.objectId}#${body.relation}@${existing.subjectNamespace}:${existing.subjectId}${existing.subjectRelation ? `#${existing.subjectRelation}` : ""}`;
      await auditFromCtx(c, {
        action: "tuple.updated",
        resourceType: existing.namespace,
        resourceId: existing.objectId,
        resourceName: tupleStr,
        detail: { previousRelation: existing.relation, newRelation: body.relation },
        result: "success",
      });

      return c.json({ success: true, data: updated });
    },
  );

  // POST /policy/tuples/batch — batch create/delete tuples (admin)
  router.post(
    "/policy/tuples/batch",
    describeRoute({
      tags: ["policy"],
      summary: "Batch create/delete relation tuples",
      responses: { 200: okJson(batchResultSchema), 401: authError, 403: adminError, 422: validationError },
    }),
    authRequired,
    adminRequired,
    validator("json", batchSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const body = c.req.valid("json");

      const created = body.create ? await batchCreateTuples(db, body.create, user.id) : [];
      const deletedCount = body.delete ? await batchDeleteTuples(db, body.delete) : 0;

      const ip = getClientIp(c);
      const userAgent = c.req.header("user-agent") ?? "unknown";
      if (created.length > 0) {
        const tuples = created.map(t => `${t.namespace}:${t.objectId}#${t.relation}@${t.subjectNamespace}:${t.subjectId}`);
        await auditFromCtx(c, {
          action: "tuple.batch_created",
          resourceType: "tuple",
          resourceId: "batch",
          resourceName: "batch",
          detail: { count: created.length, tuples: tuples.slice(0, 5), truncated: tuples.length > 5 },
          ip,
          userAgent,
          result: "success",
        });
      }
      if (deletedCount > 0) {
        await auditFromCtx(c, {
          action: "tuple.batch_deleted",
          resourceType: "tuple",
          resourceId: "batch",
          resourceName: "batch",
          detail: { count: deletedCount, ids: body.delete?.slice(0, 5) },
          ip,
          userAgent,
          result: "success",
        });
      }

      return c.json({
        success: true,
        data: { created, deletedCount },
      });
    },
  );

  // POST /policy/check — permission check (admin only)
  router.post(
    "/policy/check",
    describeRoute({
      tags: ["policy"],
      summary: "Check a permission",
      responses: { 200: okJson(checkResultSchema), 401: authError, 403: adminError, 422: validationError },
    }),
    authRequired,
    adminRequired,
    validator("json", checkSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");

      const result = await check(
        db,
        body.namespace,
        body.objectId,
        body.relation,
        body.subjectNamespace,
        body.subjectId,
      );

      return c.json({ success: true, data: result });
    },
  );

  // POST /policy/expand — expand relation tree
  router.post(
    "/policy/expand",
    describeRoute({
      tags: ["policy"],
      summary: "Expand a relation tree",
      responses: { 200: okJson(z.array(subjectNodeSchema)), 401: authError, 403: adminError, 422: validationError },
    }),
    authRequired,
    adminRequired,
    validator("json", expandSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");

      const tree = await expand(db, body.namespace, body.objectId, body.relation);

      return c.json({ success: true, data: tree });
    },
  );

  // GET /policy/users/:id/access — view user's all permissions (admin)
  router.get(
    "/policy/users/:id/access",
    describeRoute({
      tags: ["policy"],
      summary: "View a user's permissions",
      responses: { 200: okJson(z.object({ tuples: z.array(relationTupleSchema) })), 401: authError, 403: adminError },
    }),
    authRequired,
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: userId } = c.req.valid("param");

      const tuples = await getTuplesBySubject(db, "user", userId);

      return c.json({
        success: true,
        data: { tuples },
      });
    },
  );

  // GET /policy/groups/:id/access — view group's all permissions (admin)
  router.get(
    "/policy/groups/:id/access",
    describeRoute({
      tags: ["policy"],
      summary: "View a group's permissions",
      responses: { 200: okJson(z.array(relationTupleSchema)), 401: authError, 403: adminError },
    }),
    authRequired,
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: groupId } = c.req.valid("param");

      const tuples = await getTuplesBySubject(db, "group", groupId);
      return c.json({ success: true, data: tuples });
    },
  );

  // GET /policy/manifest — discovery payload describing every registered resource
  router.get(
    "/policy/manifest",
    describeRoute({
      tags: ["policy"],
      summary: "Permission manifest",
      responses: { 200: okJson(z.array(manifestEntrySchema)), 401: authError, 403: adminError },
    }),
    authRequired,
    adminRequired,
    async (c) => {
      return c.json({ success: true, data: getPermissionManifest(getRouteBindingsForResource) });
    },
  );

  // GET /policy/entities — list all entities for policy management (admin)
  router.get(
    "/policy/entities",
    describeRoute({
      tags: ["policy"],
      summary: "List policy-assignable entities",
      responses: { 200: okJson(entitiesSchema), 401: authError, 403: adminError },
    }),
    authRequired,
    adminRequired,
    async (c) => {
      const db = c.get("db");

      const [usersResult, groupsList, resourceGroupsList] = await Promise.all([
        listUsers(db, { page: 1, limit: 500 }),
        listGroups(db),
        listResourceGroups(db),
      ]);

      return c.json({
        success: true,
        data: {
          user: usersResult.data.map(u => ({ id: u.id, name: u.name || u.username })),
          group: groupsList.map(g => ({ id: g.id, name: g.name })),
          resource_group: resourceGroupsList.map(rg => ({ id: rg.id, name: rg.name })),
        },
      });
    },
  );

  // --- Resource Group Management ---

  router.get(
    "/policy/resource-groups",
    describeRoute({
      tags: ["policy"],
      summary: "List resource groups",
      responses: { 200: okJson(z.array(resourceGroupSchema)), 401: authError, 403: adminError },
    }),
    authRequired,
    adminRequired,
    async (c) => {
      const db = c.get("db");
      const groups = await listResourceGroups(db);
      return c.json({ success: true, data: groups });
    },
  );

  router.post(
    "/policy/resource-groups",
    describeRoute({
      tags: ["policy"],
      summary: "Create a resource group",
      responses: { 201: okJson(resourceGroupSchema, "Created"), 401: authError, 403: adminError, 422: validationError },
    }),
    authRequired,
    adminRequired,
    validator("json", resourceGroupBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const body = c.req.valid("json");

      const group = await createResourceGroup(db, body, user.id);

      await auditFromCtx(c, {
        action: "resource_group.created",
        resourceType: "resource_group",
        resourceId: group.id,
        resourceName: group.name,
        result: "success",
      });

      return c.json({ success: true, data: group }, 201);
    },
  );

  router.patch(
    "/policy/resource-groups/:id",
    describeRoute({
      tags: ["policy"],
      summary: "Update a resource group",
      responses: { 200: okJson(resourceGroupSchema), 401: authError, 403: adminError, 404: notFoundError, 422: validationError },
    }),
    authRequired,
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    validator("json", resourceGroupBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");

      const group = await updateResourceGroup(db, id, body);

      await auditFromCtx(c, {
        action: "resource_group.updated",
        resourceType: "resource_group",
        resourceId: group.id,
        resourceName: group.name,
        result: "success",
      });

      return c.json({ success: true, data: group });
    },
  );

  router.delete(
    "/policy/resource-groups/:id",
    describeRoute({
      tags: ["policy"],
      summary: "Delete a resource group",
      responses: { 200: okJson(z.null()), 401: authError, 403: adminError, 404: notFoundError },
    }),
    authRequired,
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");

      const deleted = await deleteResourceGroup(db, id);
      if (!deleted) {
        throw new NotFoundError("ResourceGroup", id);
      }

      await auditFromCtx(c, {
        action: "resource_group.deleted",
        resourceType: "resource_group",
        resourceId: id,
        resourceName: id,
        result: "success",
      });

      return c.json({ success: true, data: null });
    },
  );

  router.get(
    "/policy/resource-groups/:id/members",
    describeRoute({
      tags: ["policy"],
      summary: "List resource group members",
      responses: { 200: okJson(z.array(resourceGroupMemberSchema)), 401: authError, 403: adminError },
    }),
    authRequired,
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const members = await getResourceGroupMembers(db, id);
      return c.json({ success: true, data: members });
    },
  );

  router.post(
    "/policy/resource-groups/:id/members",
    describeRoute({
      tags: ["policy"],
      summary: "Add a resource group member",
      responses: { 201: okJson(resourceGroupMemberSchema, "Created"), 401: authError, 403: adminError, 404: notFoundError, 422: validationError },
    }),
    authRequired,
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    validator("json", resourceGroupMemberBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id: groupId } = c.req.valid("param");
      const body = c.req.valid("json");

      const member = await addResourceGroupMember(db, groupId, body.namespace, body.objectId, user.id);

      await auditFromCtx(c, {
        action: "resource_group.member_added",
        resourceType: "resource_group",
        resourceId: groupId,
        resourceName: `${body.namespace}:${body.objectId}`,
        result: "success",
      });

      return c.json({ success: true, data: member }, 201);
    },
  );

  router.delete(
    "/policy/resource-groups/:id/members/:tupleId",
    describeRoute({
      tags: ["policy"],
      summary: "Remove a resource group member",
      responses: { 200: okJson(z.null()), 401: authError, 403: adminError, 404: notFoundError },
    }),
    authRequired,
    adminRequired,
    validator("param", memberParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: groupId, tupleId } = c.req.valid("param");

      const removed = await removeResourceGroupMember(db, tupleId);
      if (!removed) {
        throw new NotFoundError("Member", tupleId);
      }

      await auditFromCtx(c, {
        action: "resource_group.member_removed",
        resourceType: "resource_group",
        resourceId: groupId,
        resourceName: tupleId,
        result: "success",
      });

      return c.json({ success: true, data: null });
    },
  );

  return router;
}
