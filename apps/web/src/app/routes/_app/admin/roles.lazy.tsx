import { createLazyFileRoute } from "@tanstack/react-router";
import { GlobalRolesPage } from "./-roles-page";

export const Route = createLazyFileRoute("/_app/admin/roles")({
  component: GlobalRolesPage,
});
