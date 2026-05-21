import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/portal/drive")({
  staticData: { titleKey: "drive:page.title" },
});
