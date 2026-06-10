import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin/roles")({
  staticData: { titleKey: "roles:page.title" },
});
