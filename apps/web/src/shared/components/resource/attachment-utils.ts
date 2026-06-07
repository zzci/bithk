// Pure helpers for the resource attachments UI, kept out of
// `attachment-section.tsx` so that component file only exports components
// (react-refresh/only-export-components).

export function attachmentsQueryKey(resource: string, resourceId: string) {
  return [resource, resourceId, "attachments"] as const;
}

// `image/svg+xml` is covered by the `image/` prefix; it previews safely
// because the image branch renders through <img> over a re-typed blob (the
// backend still serves SVG as octet-stream + attachment).
export function isPreviewable(mimetype: string): boolean {
  return (
    mimetype.startsWith("image/")
    || mimetype === "application/pdf"
    || mimetype.startsWith("text/")
    || mimetype === "application/json"
    || mimetype === "application/xml"
  );
}
