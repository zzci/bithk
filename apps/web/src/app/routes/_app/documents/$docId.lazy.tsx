/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { DocumentDetail } from "../-documents-detail";

export const Route = createLazyFileRoute("/_app/documents/$docId")({
  component: DocumentsDetailPage,
});

function DocumentsDetailPage() {
  const { docId } = useParams({ from: "/_app/documents/$docId" });
  const navigate = useNavigate();
  return (
    <DocumentDetail
      key={docId}
      docId={docId}
      onDeleted={() => void navigate({ to: "/documents" })}
    />
  );
}
