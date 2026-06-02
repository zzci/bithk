// Pure helpers for the projects route (tag editing + list filter mapping),
// extracted so the otherwise component-bound logic is unit-testable.

import type { ProjectStatus } from "@/shared/lib/api/projects";

// Tag list helpers live in the shared lib; re-exported so existing importers
// (and tests) of this module keep working.
export { addTag, removeTag } from "@/shared/lib/tag-utils";

/**
 * Map the single list-filter chip selection to query params. The list uses one
 * mutually-exclusive control: "__active__" (active projects, the default),
 * "__archived__" (archived projects), or a tag id. There is no unfiltered
 * option — the list never shows archived projects by default.
 */
export function projectsFilterToQuery(filter: string): { status?: ProjectStatus; tagId?: string } {
  if (filter === "__active__")
    return { status: "active" };
  if (filter === "__archived__")
    return { status: "archived" };
  return { tagId: filter };
}
