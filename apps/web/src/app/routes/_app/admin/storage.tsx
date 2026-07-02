import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin/storage")({
  staticData: { titleKey: "storage:page.title" },
});
