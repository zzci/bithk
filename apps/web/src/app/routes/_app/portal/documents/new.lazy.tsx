/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { CreateForm } from "../-documents-create";

export const Route = createLazyFileRoute("/_app/portal/documents/new")({
  component: DocumentsNew,
});

function DocumentsNew() {
  const navigate = useNavigate();
  return (
    <CreateForm
      onCancel={() => void navigate({ to: "/portal/documents" })}
      onCreated={id => void navigate({ to: "/portal/documents/$docId", params: { docId: id } })}
    />
  );
}
