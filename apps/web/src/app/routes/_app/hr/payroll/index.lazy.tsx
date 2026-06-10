import { createLazyFileRoute } from "@tanstack/react-router";
import { HrPayrollPage } from "../-payroll-page";

// Admin gating lives in the `/hr` layout route (`_app/hr.tsx`).
export const Route = createLazyFileRoute("/_app/hr/payroll/")({
  component: HrPayrollPage,
});
