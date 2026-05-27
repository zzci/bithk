# FEAT-012 Ship cover image

- Status: Done
- Plan: -
- Updated: 2026-05-27

## Goal

Give ships a cover image (set / replace / remove + display), mirroring the
project cover image (FEAT-011).

## Scope

Backend (apps/api):
1. `ship/schema.ts`: add `coverReferenceId` (FK -> `file_references`,
   `onDelete: set null`). Generate the migration with `bun run db:generate`.
2. `ship.service.ts`: `ShipView.coverImageUrl`; cover loaders; `setShipCover`
   (release old ref -> `uploadAndReference("ship_cover")` -> update column) and
   `removeShipCover`.
3. `ship.cover.permission.ts`: register the `ship_cover` file permission hook
   (canRead: ship readable; canDelete: ship manageable — both anchored on the
   base project). Wire it in `ship/index.ts`.
4. `ship.routes.ts`: `POST /ships/:shortId/cover-image` (manage, image only) and
   `DELETE /ships/:shortId/cover-image`.

Frontend (apps/web):
5. `api/ships.ts`: `ShipView.coverImageUrl`; `useSetShipCover` /
   `useRemoveShipCover`.
6. Detail header + list cards: show the cover when present.
7. Overview tab (canManage): cover upload / remove control.
8. i18n (en/zh) ship `cover.*`.

## Verification

- `bun run check` passes (incl. generated migration + new cover tests).
