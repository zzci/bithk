/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { CreateForm } from "../-documents-create";

export const Route = createLazyFileRoute("/_app/documents/new")({
  component: DocumentsNew,
});

function DocumentsNew() {
  const navigate = useNavigate();
  return (
    <CreateForm
      onCancel={() => void navigate({ to: "/documents" })}
      onCreated={id => void navigate({ to: "/documents/$docId", params: { docId: id } })}
    />
  );
}
