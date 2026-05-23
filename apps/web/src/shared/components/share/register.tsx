// Register both shareable resources into the frontend share registry. Imported
// for its side effects where the app initializes, mirroring how the backend
// wires its adapter registry.

import { registerShareResource } from "@/shared/lib/share/registry";

import { DocumentCollaboratorSection } from "./document-collaborators";
import { DocumentPublicPreview } from "./previews/document-preview";
import { DrivePublicPreview } from "./previews/drive-preview";

registerShareResource({
  resourceType: "drive_entry",
  labelKey: "resource.drive_entry",
  renderPublicPreview: (meta, token) => <DrivePublicPreview meta={meta} token={token} />,
});

registerShareResource({
  resourceType: "document",
  labelKey: "resource.document",
  renderPublicPreview: (meta, token) => <DocumentPublicPreview meta={meta} token={token} />,
  renderExtraSection: docId => <DocumentCollaboratorSection docId={docId} />,
});
