import { createFileRoute } from "@tanstack/react-router";

// Standalone spreadsheet editor page. The trailing underscore on `drive_`
// de-nests it from the `/drive` page layout (it replaces the drive view rather
// than rendering inside it) while keeping the URL `/drive/sheet/$entryId`.
// The component lives in the sibling `.lazy.tsx` so Univer and the heavy
// spreadsheet engine stay in a route-level lazy chunk, out of the main bundle.
export const Route = createFileRoute("/_app/drive_/sheet/$entryId")({
  staticData: { titleKey: "drive:sheet.untitled" },
});
