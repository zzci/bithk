/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, Navigate } from "@tanstack/react-router";
import { useAuthStore } from "@/shared/stores/auth";
import { FinanceColleaguesPage } from "../-colleagues-page";

export const Route = createLazyFileRoute("/_app/finance/colleagues/")({
  component: GuardedFinanceColleaguesPage,
});

// Finance is admin-only end to end (the API rejects non-admins with 403);
// mirror the `_app/admin` layout gate so non-admins never land on the page.
function GuardedFinanceColleaguesPage() {
  const user = useAuthStore(s => s.user);

  if (!user || user.role !== "admin") {
    return <Navigate to="/overview" />;
  }

  return <FinanceColleaguesPage />;
}
