import type { FavoriteTargetType } from "./schema";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { getRequestUserModules } from "@/modules/account/groups/module-gate";
import { ISSUE_STATUSES } from "@/modules/issue/schema";
import { PROCUREMENT_STATUSES } from "@/modules/procurement/schema";
import { PROJECT_STATUSES } from "@/modules/project/schema";
import { NotFoundError, ValidationError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson } from "@/shared/lib/openapi";
import { requireParam } from "@/shared/lib/route-params";
import { authRequired } from "@/shared/middleware/auth";
import {
  addFavorite,
  getOverview,
  listFavorites,
  removeFavorite,
  resolveFavoriteTarget,
  resolveFavoriteTargetForRemoval,
} from "./overview.service";
import { FAVORITE_TARGET_TYPES } from "./schema";

const favoriteProjectSchema = z.object({
  targetType: z.literal("project"),
  id: z.string(),
  name: z.string(),
  code: z.string(),
  status: z.enum(PROJECT_STATUSES),
  favoritedAt: z.string(),
});
const favoriteIssueSchema = z.object({
  targetType: z.literal("issue"),
  id: z.string(),
  title: z.string(),
  status: z.enum(ISSUE_STATUSES),
  priority: z.string(),
  dueDate: z.string().nullable(),
  projectId: z.string(),
  projectName: z.string(),
  favoritedAt: z.string(),
});
const favoriteProcurementSchema = z.object({
  targetType: z.literal("procurement"),
  id: z.string(),
  itemName: z.string(),
  status: z.enum(PROCUREMENT_STATUSES),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  projectId: z.string(),
  projectName: z.string(),
  favoritedAt: z.string(),
});
const favoriteSchema = z.discriminatedUnion("targetType", [
  favoriteProjectSchema,
  favoriteIssueSchema,
  favoriteProcurementSchema,
]);

const overviewSchema = z.object({
  myIssues: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(ISSUE_STATUSES),
    priority: z.string(),
    dueDate: z.string().nullable(),
    projectId: z.string(),
    projectName: z.string(),
    updatedAt: z.string(),
  })),
  openProcurements: z.array(z.object({
    id: z.string(),
    itemName: z.string(),
    status: z.enum(PROCUREMENT_STATUSES),
    priority: z.string(),
    amount: z.number().nullable(),
    currency: z.string().nullable(),
    dueDate: z.string().nullable(),
    projectId: z.string(),
    projectName: z.string(),
    updatedAt: z.string(),
  })),
});

function isFavoriteTargetType(v: string): v is FavoriteTargetType {
  return (FAVORITE_TARGET_TYPES as readonly string[]).includes(v);
}

function requireFavoriteType(v: string): FavoriteTargetType {
  if (!isFavoriteTargetType(v))
    throw new ValidationError("Unknown favorite type", { type: "Unknown favorite type" });
  return v;
}

/**
 * Overview workbench surfaces (FEAT-048): per-user favorites plus the
 * cross-project "my issues" / "open procurements" aggregates.
 *
 * The prefixes are mounted ungated (like `/search`) because the favorites
 * table is type-generic; module visibility is enforced INSIDE each handler —
 * every current target type is projects-module content, so a caller without
 * the `projects` module gets empty data and fail-closed 404s on writes.
 */
export function overviewRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  // GET /overview — cross-project workbench aggregates for the caller
  router.get(
    "/overview",
    describeRoute({
      tags: ["overview"],
      summary: "Overview workbench aggregates (my issues, open procurements)",
      responses: {
        200: okJson(overviewSchema),
        401: { description: "Unauthenticated", ...errorJson },
      },
    }),
    async (c) => {
      const user = c.get("user");
      const modules = await getRequestUserModules(c, user);
      if (!modules.includes("projects"))
        return c.json({ success: true, data: { myIssues: [], openProcurements: [] } });
      const data = await getOverview(c.get("db"), user);
      return c.json({ success: true, data });
    },
  );

  // GET /favorites — the caller's favorites, hydrated and visibility-checked
  router.get(
    "/favorites",
    describeRoute({
      tags: ["overview"],
      summary: "List the caller's favorites",
      responses: {
        200: okJson(z.array(favoriteSchema)),
        401: { description: "Unauthenticated", ...errorJson },
      },
    }),
    async (c) => {
      const user = c.get("user");
      const modules = await getRequestUserModules(c, user);
      if (!modules.includes("projects"))
        return c.json({ success: true, data: [] });
      const data = await listFavorites(c.get("db"), user);
      return c.json({ success: true, data });
    },
  );

  // PUT /favorites/:type/:id — favorite a target the caller can view
  router.put(
    "/favorites/:type/:id",
    describeRoute({
      tags: ["overview"],
      summary: "Favorite a project, issue, or procurement",
      responses: {
        200: okJson(z.object({ favorited: z.literal(true) })),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Target not found or not visible", ...errorJson },
        422: { description: "Unknown favorite type", ...errorJson },
      },
    }),
    async (c) => {
      const user = c.get("user");
      const targetType = requireFavoriteType(requireParam(c, "type"));
      const shortId = requireParam(c, "id");
      const db = c.get("db");
      const modules = await getRequestUserModules(c, user);
      // Same 404 as an unknown/inaccessible target: a hidden module must not
      // change the error shape.
      const targetId = modules.includes("projects")
        ? await resolveFavoriteTarget(db, user, targetType, shortId)
        : null;
      if (!targetId)
        throw new NotFoundError("Favorite target", shortId);
      await addFavorite(db, user.id, targetType, targetId);
      return c.json({ success: true, data: { favorited: true } });
    },
  );

  // DELETE /favorites/:type/:id — idempotent unfavorite (works even after the
  // target became invisible or was deleted; nothing about it leaks).
  router.delete(
    "/favorites/:type/:id",
    describeRoute({
      tags: ["overview"],
      summary: "Remove a favorite",
      responses: {
        200: okJson(z.object({ favorited: z.literal(false) })),
        401: { description: "Unauthenticated", ...errorJson },
        422: { description: "Unknown favorite type", ...errorJson },
      },
    }),
    async (c) => {
      const user = c.get("user");
      const targetType = requireFavoriteType(requireParam(c, "type"));
      const shortId = requireParam(c, "id");
      const db = c.get("db");
      const targetId = await resolveFavoriteTargetForRemoval(db, targetType, shortId);
      if (targetId)
        await removeFavorite(db, user.id, targetType, targetId);
      return c.json({ success: true, data: { favorited: false } });
    },
  );

  return router;
}
