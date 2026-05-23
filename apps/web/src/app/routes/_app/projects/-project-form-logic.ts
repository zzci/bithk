// Pure helpers for the projects route (tag editing + list filter mapping),
// extracted so the otherwise component-bound logic is unit-testable.

import type { ProjectStatus } from "@/shared/lib/api/projects";

/**
 * Map the single list-filter chip selection to query params. The list uses one
 * mutually-exclusive control: "__all__" (no filter), "__archived__" (a status
 * filter surfaced as a chip), or a tag id.
 */
export function projectsFilterToQuery(filter: string): { status?: ProjectStatus; tagId?: string } {
  if (filter === "__all__")
    return {};
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
