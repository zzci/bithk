import { createLazyFileRoute } from "@tanstack/react-router";
import { HrColleaguesPage } from "../-colleagues-page";

// Access gating lives in the generic `_app` module guard (`hr` module key),
// which covers every HR sub-module in one place.
export const Route = createLazyFileRoute("/_app/hr/colleagues/")({
  component: HrColleaguesPage,
});
