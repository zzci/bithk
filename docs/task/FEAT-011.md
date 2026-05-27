# FEAT-011 Project cover image

- Status: Done
- Plan: -
- Updated: 2026-05-27

## Goal

Let a project have a cover image that can be set, replaced, removed, and is
displayed on the project detail header and the project list cards.

## Scope

Backend (apps/api):
1. `project/schema.ts`: add `coverReferenceId` (FK -> `file_references`,
   `onDelete: set null`). Generate the migration with `bun run db:generate`.
2. `project.service.ts`: `ProjectView.coverImageUrl: string | null`; batch +
   single cover loaders (join to `files` to build
   `/api/files/<fileId>/content?ref=<refId>&inline=true`); `setProjectCover`
   (release old ref -> `uploadAndReference("project_cover")` -> update column)
   and `removeProjectCover`.
3. `project.cover.permission.ts`: register the `project_cover` file permission
   hook (canRead: project member / admin; canDelete: `project.manage`). Wire it
   in `project/index.ts`.
4. `project.routes.ts`: `POST /projects/:id/cover-image` (`project.manage`,
   multipart `file`, image types only) and `DELETE /projects/:id/cover-image`.

Frontend (apps/web):
5. `api/projects.ts`: `ProjectView.coverImageUrl`; `useSetProjectCover`
   (FormData) and `useRemoveProjectCover` mutations.
6. Detail header: render the cover image when present (replace the placeholder).
7. List cards: show a cover banner when present.
8. Settings General tab: cover upload / remove control.
9. i18n (en/zh).

## Verification

- `bun run check` passes (includes the generated migration applying cleanly).
- Upload sets and displays a cover; remove clears it; non-members cannot read
  another project's cover (404).
