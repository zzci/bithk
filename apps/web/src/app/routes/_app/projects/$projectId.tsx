import { createFileRoute } from "@tanstack/react-router";

/** Tabs that can be deep-linked / restored via the `?tab=` search param. */
export const PROJECT_DETAIL_TABS = ["overview", "issues", "procurement", "files"] as const;
export type ProjectDetailTab = typeof PROJECT_DETAIL_TABS[number];

export interface ProjectDetailSearch {
  /** When true, the project settings dialog opens on mount (deep link from the list). */
  readonly settings?: boolean;
  /** Active tab to restore on mount; omitted means the default "overview" tab. */
  readonly tab?: ProjectDetailTab;
}

// "overview" is the default, so it is dropped from the URL to keep links clean and
// any unknown tab value falls back to the default by being omitted.
function parseTab(value: unknown): ProjectDetailTab | undefined {
  return typeof value === "string"
    && value !== "overview"
    && (PROJECT_DETAIL_TABS as readonly string[]).includes(value)
    ? value as ProjectDetailTab
    : undefined;
}

export function validateProjectDetailSearch(search: Record<string, unknown>): ProjectDetailSearch {
  const settings = search.settings === true || search.settings === "true";
  const tab = parseTab(search.tab);
  return {
    ...(settings ? { settings: true } : {}),
    ...(tab ? { tab } : {}),
  };
}

export const Route = createFileRoute("/_app/projects/$projectId")({
  validateSearch: validateProjectDetailSearch,
});
