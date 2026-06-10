import { createLazyFileRoute } from "@tanstack/react-router";
import { HrApprovalsPage } from "../-approvals-page";

// Admin gating lives in the `/hr` layout route (`_app/hr.tsx`).
export const Route = createLazyFileRoute("/_app/hr/approvals/")({
  component: HrApprovalsPage,
});
