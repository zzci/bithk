import { createFileRoute, redirect } from "@tanstack/react-router";

// Bare `/hr` has no content of its own — land on the colleagues tab.
export const Route = createFileRoute("/_app/hr/")({
  beforeLoad: () => {
    throw redirect({ to: "/hr/colleagues" });
  },
});
