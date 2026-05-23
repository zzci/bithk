import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/drive")({
  staticData: { titleKey: "drive:page.title" },
});
