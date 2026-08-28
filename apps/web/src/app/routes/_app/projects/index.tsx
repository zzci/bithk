import type { ProjectSectionKey } from "@/shared/lib/api/projects";
import { createFileRoute } from "@tanstack/react-router";
import { PROJECT_SECTION_KEYS } from "@/shared/lib/api/projects";

export interface ProjectsListSearch {
  /**
   * Narrow the list to projects that mount this section — the preset link
   * behind the sidebar's "Ships" entry (`?section=ship-profile`). Unknown
   * values are dropped so a hand-typed URL cannot wedge the list.
   */
  readonly section?: ProjectSectionKey;
}

export function validateProjectsListSearch(search: Record<string, unknown>): ProjectsListSearch {
  const section = search.section;
  return typeof section === "string" && (PROJECT_SECTION_KEYS as readonly string[]).includes(section)
    ? { section: section as ProjectSectionKey }
    : {};
}

export const Route = createFileRoute("/_app/projects/")({
  validateSearch: validateProjectsListSearch,
  staticData: { titleKey: "projects:page.title" },
});
