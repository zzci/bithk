// Shared section gate (PLAN-108 §3). Section routes live in their owning
// modules and wrap themselves in `requireSection(key)`; sections keep their
// existing per-route capability gates on top of it.

import type { MiddlewareHandler } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { NotFoundError } from "@/shared/lib/errors";
import { resolveProjectId } from "./project.service";
import { hasSection } from "./section.service";

export interface RequireSectionOptions {
  /** Route param carrying the project short id. Defaults to `"projectId"`. */
  readonly param?: string;
}

/**
 * Assert the project named by the route param exists and has `key` mounted.
 *
 * Fail-closed existence policy (docs/decisions/003): a missing project, a
 * soft-deleted one and an unmounted section all surface as the same 404, so a
 * caller cannot probe which projects have which sections.
 */
export function requireSection(key: string, options: RequireSectionOptions = {}): MiddlewareHandler<ProtectedEnv> {
  const param = options.param ?? "projectId";
  return async (c, next) => {
    const shortId = c.req.param(param) ?? "";
    const db = c.get("db");
    const projectId = await resolveProjectId(db, shortId);
    if (!projectId)
      throw new NotFoundError("Project", shortId);
    if (!await hasSection(db, projectId, key))
      throw new NotFoundError("Project", shortId);
    await next();
  };
}
