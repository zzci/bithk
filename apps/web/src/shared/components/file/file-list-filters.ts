// Filter unions for the shared file-list surface.
//
// These string-union filter types are consumed by the surface's filter bar,
// sorting, and inner list. The presentational, reusable data shapes and helpers
// (`DisplayItem`, `FileType`, `detectFileType`, `FILE_ICONS`,
// `entryToDisplayItem`) live in `@/shared/lib/file`.

export type DriveSortBy = "name" | "modified";
export type DriveTypeFilter = "all" | "folders" | "files" | "pdf" | "image" | "document" | "spreadsheet";
export type DriveOwnerFilter = "all" | "me";
export type DriveModifiedFilter = "all" | "today" | "7d" | "30d";
export type DriveSourceFilter = "all" | "current";
