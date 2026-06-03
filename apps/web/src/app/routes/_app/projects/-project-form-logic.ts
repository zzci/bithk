// Pure helpers for the projects route (tag editing + list filter mapping),
// extracted so the otherwise component-bound logic is unit-testable.

import type { ProjectStatus } from "@/shared/lib/api/projects";

// Tag list helpers live in the shared lib; re-exported so existing importers
// (and tests) of this module keep working.
export { addTag, removeTag } from "@/shared/lib/tag-utils";

/**
 * Map the single status-filter chip to query params. The list shows active
 * projects by default ("__active__"); "__archived__" switches to archived ones.
 * There is no unfiltered option. Tag filtering is multi-select and threaded
 * separately by the caller, so it is not handled here.
 */
export function projectsFilterToQuery(filter: "__active__" | "__archived__"): { status?: ProjectStatus } {
  if (filter === "__archived__")
    return { status: "archived" };
  return { status: "active" };
}
