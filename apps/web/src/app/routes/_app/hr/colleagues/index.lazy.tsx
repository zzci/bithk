import { createLazyFileRoute } from "@tanstack/react-router";
import { HrColleaguesPage } from "../-colleagues-page";

// Admin gating lives in the `/hr` layout route (`_app/hr.tsx`), which guards
// every HR sub-module in one place.
export const Route = createLazyFileRoute("/_app/hr/colleagues/")({
  component: HrColleaguesPage,
});
