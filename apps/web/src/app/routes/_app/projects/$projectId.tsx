import { createFileRoute } from "@tanstack/react-router";

export interface ProjectDetailSearch {
  /** When true, the project settings dialog opens on mount (deep link from the list). */
  readonly settings?: boolean;
}

// The active tab is encoded in the path (one route per tab), not the search
// params; only the settings deep-link flag remains as a search param.
export function validateProjectDetailSearch(search: Record<string, unknown>): ProjectDetailSearch {
  const settings = search.settings === true || search.settings === "true";
  return settings ? { settings: true } : {};
}

export const Route = createFileRoute("/_app/projects/$projectId")({
  validateSearch: validateProjectDetailSearch,
});
