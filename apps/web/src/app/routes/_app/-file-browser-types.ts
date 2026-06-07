// Drive-route-local filter unions for the drive file-list surface.
//
// These string-union filter types couple to the drive routes (only the
// `-drive-*` modules consume them), so they stay in the route layer. The
// presentational, reusable shapes and helpers (`DisplayItem`, `FileType`,
// `detectFileType`, `FILE_ICONS`, `entryToDisplayItem`) live in
// `@/shared/lib/file`.

export type DriveSortBy = "name" | "modified";
export type DriveTypeFilter = "all" | "folders" | "files" | "pdf" | "image" | "document" | "spreadsheet";
export type DriveOwnerFilter = "all" | "me";
export type DriveModifiedFilter = "all" | "today" | "7d" | "30d";
export type DriveSourceFilter = "all" | "current";
