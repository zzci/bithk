/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { EmptyState } from "../-documents-create";

export const Route = createLazyFileRoute("/_app/portal/documents/")({
  component: DocumentsIndex,
});

function DocumentsIndex() {
  const navigate = useNavigate();
  return <EmptyState onCreate={() => void navigate({ to: "/portal/documents/new" })} />;
}
