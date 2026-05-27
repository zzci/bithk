import { createFileRoute } from "@tanstack/react-router";

export interface ProjectDetailSearch {
  /** When true, the project settings dialog opens on mount (deep link from the list). */
  readonly settings?: boolean;
}

export const Route = createFileRoute("/_app/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>): ProjectDetailSearch =>
    (search.settings === true || search.settings === "true" ? { settings: true } : {}),
});
