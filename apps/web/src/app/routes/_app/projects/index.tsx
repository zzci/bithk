import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/projects/")({
  staticData: { titleKey: "projects:page.title" },
});
