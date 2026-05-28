// Pure helpers for the projects route (tag editing + list filter mapping),
// extracted so the otherwise component-bound logic is unit-testable.

import type { ProjectStatus } from "@/shared/lib/api/projects";

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

/** Append a trimmed tag, ignoring blanks and case-insensitive duplicates. */
export function addTag(list: readonly string[], raw: string): readonly string[] {
  const name = raw.trim();
  if (!name)
    return list;
  if (list.some(tag => tag.toLowerCase() === name.toLowerCase()))
    return list;
  return [...list, name];
}

export function removeTag(list: readonly string[], name: string): readonly string[] {
  return list.filter(tag => tag !== name);
}
