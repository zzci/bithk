import { createLazyFileRoute } from "@tanstack/react-router";
import { FinanceColleaguesPage } from "../-colleagues-page";

export const Route = createLazyFileRoute("/_app/finance/colleagues/")({
  component: FinanceColleaguesPage,
});
