import { createFileRoute } from "@tanstack/react-router";
import { HrPlaceholder } from "../-hr-placeholder";

export const Route = createFileRoute("/_app/hr/approvals/")({
  component: () => <HrPlaceholder module="approvals" />,
});
