# PLAN-005 — Drive sharing on policy tuples: direct grants, subtree inheritance, ownership sync

- **status**: draft
- **createdAt**: 2026-05-23
- **approvedAt**: (pending)
- **relatedTask**: FEAT-005

> **Record status (2026-05-23):** plan only — NOT implemented. Deliberately
> deferred to avoid colliding with the in-flight FEAT-004 (project management)
> work, which currently has uncommitted edits to the exact files this plan
> rewrites (`drive.permission.ts`, `drive/schema.ts`, `db/schema.ts`,
> `drive.routes.ts`, `drive.service.ts`). Two open decisions still gate
> implementation — see *Open decisions* below. Resume after FEAT-004 lands and
> the decisions are answered.

## Context

FEAT-002 unified token-based shares into one polymorphic `shares` table. That
merged drive `direct` (internal user-to-user grants) together with public
links because the old `drive_file_shares` table did. Review showed the cut is
wrong: a `direct` share carries none of the per-link state (`token`,
`password`, `expiresAt`, `maxDownloads`, `downloadCount` are all dead for
direct rows — `createShare` even generates a never-used token). A `direct`
share is purely "user X has permission P on entry R" — a relationship, which
is exactly what policy tuples model. Documents already express their internal
(collaborator) sharing as tuples; drive should too.

Findings:

- Drive **already** registers with the policy framework:
  `drive.permission.ts::driveAccess = defineResource({ namespace: "drive_entry", actions: { read→viewer, update→editor, delete→owner, download→viewer } })`.
  It authorizes through a `bypass` hook (`hasCapabilityFor` →
  `resolveEntryCapabilities`); the Zanzibar tuple store currently has **zero**
  drive tuples.
- `resolveEntryCapabilities` (drive.permission.ts:61) unions three additive
  sources: global admin, ownership/team-directory/project role, and the
  **direct share** (read today from `shares` where
  `shareType='direct'`, lines 92-108).
- `relation_tuples` (policy/schema.ts) has `createdBy` + `createdAt` and
  indexes on both object and subject — so "shared with me" (by subject) and
  "shared by me" (by createdBy) are both queryable.
- Documents grant via `documentAccess.grant(ctx, { subject, relation, objectId })`
  with `canGrant`/`canRevoke`/`onGranted`/`onRevoked` hooks
  (document.permission.ts:101-104, document.service.ts::addDocumentShare).
  Grants/revokes emit `document.share_added/removed` audit events.
- Drive direct's three permissions collapse cleanly onto tuple relations:
  old `view` and `download` both granted read+download → `viewer`; `edit`
  added update → `editor`. No real loss (current code already treats view and
  download identically in `resolveEntryCapabilities`).
- **Stale loose end from FEAT-002**: `document.permission.ts` routes still
  list `/documents/:id/public-links` bindings (lines 68-71) for routes that no
  longer exist. Fold the cleanup in here.

## Expanded scope (2026-05-23)

The directive grew: besides moving `direct` to tuples, also do **subtree
inheritance** (a grant on a folder flows to descendants) and **ownership
synchronization** (ownership represented as tuples, kept in lockstep). That
turns this into "resolve drive permissions through the Zanzibar engine," like
documents — not just a storage swap. New design below supersedes the
public-only `share` trim (still in scope) and the simple direct-tuple read.

### `drive_entry` namespace (new, in `policy/namespace-config.ts`)

Mirror the `item` namespace's inheritance pattern:

```
drive_entry:
  owner       : [ this ]
  editor      : [ this, owner, parent_entry -> editor ]
  viewer      : [ this, editor, parent_entry -> viewer ]
  parent_entry: [ this ]              # drive_entry -> drive_entry upward edge
```

This gives direct-grant inheritance for free: a `viewer`/`editor` tuple on a
folder flows to every descendant via `parent_entry`, exactly as
`parent_item` does for documents.

### Tuple lockstep maintenance (the "sync" work)

Written/rewritten inside the same transaction as the business columns
(`drive.service.ts`), mirroring how documents maintain `parent_item`:

- **parent_entry**: on create / move / restore, write
  `(drive_entry:id, parent_entry, drive_entry:parentEntryId)` — only when the
  parent is a real entry (skip the `""` root sentinel). Rewrite on move.
- **owner** (user-owned): on create, write
  `(drive_entry:id, owner, user:ownerId)`. This is the "ownership sync".
- **delete**: drop all `drive_entry` tuples for the purged ids (owner,
  parent_entry, viewer, editor) — replaces the FK cascade the old
  `drive_file_shares` table had.

### `resolveEntryCapabilities` rewrite

- admin → all.
- Resolve `viewer` / `editor` / `owner` through the engine
  (`check(db, "drive_entry", entryId, relation, "user", actorId)`), which now
  covers user-ownership + direct grants + parent-chain inheritance uniformly.
  Map: `owner` → all caps; `editor` → read+download+update; `viewer` →
  read+download.
- **team_directory / project**: keep the bespoke role union
  (`getDirectoryRole` / `getProjectRole`) — these cover the whole owned subtree
  intrinsically (every entry carries the same owning directory/project) and
  have their own role tables; duplicating them as usersets buys nothing here.
  Final caps = bespoke(team/project role) ∪ engine(owner/direct/inherited).

### Backfill (REQUIRED — not optional)

Existing drive entries have **no** tuples. The moment user-ownership resolves
through the engine, every existing personal file becomes inaccessible to its
owner unless backfilled. A one-time backfill derives, for each existing entry:
`(drive_entry:id, owner, user:ownerId)` for user-owned, and
`(drive_entry:id, parent_entry, drive_entry:parentEntryId)` for non-root.
Implemented as an idempotent startup/seed routine keyed off `driveEntries`
(derived data, not a hand-written SQL migration).

## Open decisions (need your call before implementing)

1. **Team-directory / project ownership** — recommend keeping bespoke
   (rationale above: whole-subtree coverage + existing role tables, no
   inheritance gap). The heavier alternative is full Zanzibar: model
   `team_directory` / `project` as group namespaces with membership tuples and
   point `drive_entry.owner` at those usersets, then drop the bespoke resolver
   entirely. Uniform but a much larger migration + ongoing membership-tuple
   sync. **Default: keep bespoke unless you want the full migration.**
2. **Backfill delivery** — idempotent startup routine (recommended) vs a
   separate one-shot script. Either way it is required.

## Original proposal (direct → tuples; share → public-only)

Move drive `direct` to tuples; shrink `share` to public links only; keep
drive ownership/team/project bespoke.

### Backend — `share` module becomes public-only

- `schema.ts`: drop `share_type` and `shared_with_user_id` columns (and the
  `shares_share_type_idx` / `shares_shared_with_idx` indexes). All rows are
  public links. Keep `permission` (drive public links use view/download/edit;
  documents view only), `token`, `password`, `expiresAt`, `maxDownloads`,
  `downloadCount`, `isActive`.
- `share.service.ts`: `createShare` keeps only the public-link path (drop the
  direct branch, recipient validation, `hasActiveShare("direct")`). Remove
  `listReceivedShares` / `listSentShares`. Keep `listLinkShares`,
  `listSharesForResource`, update/revoke, gate, reserveDownload.
- `adapter.ts`: drop `capabilities.shareTypes` (always public link); keep
  `capabilities.permissions`.
- `share.routes.ts`: remove `/shares/received` and `/shares/sent`. Keep
  `/shares/links`, `/shares/capabilities/:type`, `/shares/:type/:id`
  (list+create public link), `/shares/:shareId` (update/revoke).
- Drizzle migration: drop the two columns + their indexes.

### Backend — drive direct as tuples

- `drive.permission.ts`: add grant hooks to `driveAccess`:
  - `canGrant` / `canRevoke`: actor holds the `share` capability on the entry
    (`resolveEntryCapabilities(...).has("share")`).
  - `onGranted` / `onRevoked`: emit `drive.share_added` / `drive.share_removed`
    audit events (mirror `emitShareAudit`).
  - Add `/drive/entries/:id/shares` (GET/POST) + `/drive/entries/:id/shares/:tupleId`
    (DELETE) to `driveAccess.routes` bound to a manage action.
  - `resolveEntryCapabilities`: replace the `shares` query (lines 92-108) with
    a `relation_tuples` lookup — actor's `viewer`/`editor` tuple on
    (`drive_entry`, entryId). `viewer` ⇒ read+download; `editor` ⇒ +update.
    Still additive, still no `share`/`delete` from a direct grant.
- `drive.service.ts` (or a new `drive.share.service.ts`): `addDriveShare` /
  `removeDriveShare` / `listDriveSharesForEntry` / `listReceivedDriveShares` /
  `listSentDriveShares` — thin wrappers over `driveAccess.grant/revoke` and
  `relation_tuples` queries, mirroring `addDocumentShare`. Map permission
  `view|download` → `viewer`, `edit` → `editor`.
- `drive.routes.ts`: re-add the entry-share + inbox routes (removed in
  FEAT-002), now tuple-backed: GET/POST `/drive/entries/:id/shares`,
  DELETE `/drive/entries/:id/shares/:tupleId`, GET `/drive/shares/received`,
  GET `/drive/shares/sent`.
- `drive.service.ts::purgeEntries`: replace the `deleteSharesForResource`
  call (FEAT-002) — public links still go through that; direct tuples are
  cleaned by deleting `relation_tuples` for namespace `drive_entry`, the
  entry ids. (Keep both: public-link rows + drive tuples.)
- Cleanup: remove the stale `/documents/:id/public-links` route bindings in
  `document.permission.ts`.

### Frontend

- Drive internal sharing leaves the unified public `ShareDialog` and becomes a
  tuple-backed collaborators section — symmetric with documents'
  `renderExtraSection`. Drive's registry entry gains a `renderExtraSection`
  that lists/grants/revokes drive collaborators via the new
  `/drive/entries/:id/shares` endpoints. The public-link section stays in the
  shared dialog for both resources.
- `shared/lib/api/share.ts`: drop `direct` types, `useReceivedShares`,
  `useSentShares`, and the create-direct path. Public-link only.
- `shared/lib/api/drive.ts`: add drive collaborator types/keys/hooks
  (`useDriveShares`, `useGrantDriveShare`, `useRevokeDriveShare`,
  `useReceivedDriveShares`, `useSentDriveShares`).
- `-share-lists.tsx`: the "shared with me / by me" surfaces read the drive
  endpoints (these are drive-internal, never were document-internal).
- i18n: keep en/zh parity; relabel internal-share copy under `drive`/`share`
  as needed.

### Tests

- Update `share.service.test.ts`: remove direct-share cases; keep public-link
  + gate + budget + folder/document content.
- Update `drive.permission.test.ts`: the "additive direct shares" block now
  seeds tuples via `addDriveShare` instead of `createShare`.
- New `drive.share.service.test.ts`: grant/list/revoke + received/sent inbox.

## Risks

- **Reverses part of FEAT-002**: drive entry-share routes, inboxes, and the
  share-lists/dialog direct UI return in tuple form. Rework, not just delete.
- **view/download merge**: direct grants lose the (already cosmetic)
  view-vs-download distinction; both map to `viewer`. Confirm acceptable.
- **Subtree inheritance now IN scope** via `parent_entry` tuple_to_userset.
  Correctness hinges on the `parent_entry` tuple tree being complete and in
  sync — a missing/stale edge silently breaks inheritance for that subtree.
- **Backfill is load-bearing**: if it misses entries, their owners lose access
  the instant ownership resolves through the engine. Must be idempotent and
  cover every existing entry; verify counts (entries vs owner tuples).
- **Engine cost**: `resolveEntryCapabilities` goes from a couple of indexed
  lookups to a recursive `check` walking `parent_entry`. Bounded by tree depth;
  documents already pay this for `parent_item`. Acceptable, but it is a
  per-request cost on every drive entry access.
- **Move correctness**: rewriting `parent_entry` on move must happen in the
  same transaction as the `parentEntryId` update, or inheritance desyncs.
- **Cascade cleanup**: entry deletion must drop both public-link rows and
  direct tuples; a missed path orphans tuples.
- **Migration drops columns**: existing direct rows in `shares` are lost (no
  data migration — research stage, accepted).
- Group sharing (subject = group) becomes possible for drive once direct is a
  tuple; not built in this plan but the door opens.

## Scope

- Backend: `drive_entry` namespace in namespace-config; parent_entry + owner
  tuple lockstep in drive.service (create/move/restore/delete); engine-based
  `resolveEntryCapabilities`; drive grant hooks + share service + routes;
  share schema/service/routes trim (public-only); shares-table column drop
  migration; backfill routine; audit events; document.permission stale-binding
  cleanup. ~16 files.
- Frontend: share api trim, drive collaborator api + registry `renderExtraSection`,
  share-lists rework, i18n. ~8 files.
- Tests: share.service (trim direct), drive.permission (tuple-based +
  inheritance cases), new drive.share.service, backfill test. ~4 files.

## Alternatives

- **Keep direct in `share` (status quo from FEAT-002).** Rejected: dead
  columns + dead token, two divergent internal-sharing models, no group
  support, conceptually wrong (a relationship stored as a capability link).
- **Bring drive ownership + team-directory + project into tuples too (full
  Zanzibar for drive).** Larger; not required by the ask. Only `direct` is a
  pure relationship today — ownership/role derive from `ownerType` and are
  cheap additive lookups. Deferred.

## Annotations

- 2026-05-23 (user): direct is internal CRUD permission — a basic permission
  relationship — so it should be a tuple; `share` should own only public
  sharing. Plan written to that directive; awaiting `proceed`.
- 2026-05-23 (user): also do subtree inheritance and ownership synchronization.
  Expanded the plan to a `drive_entry` Zanzibar namespace with `parent_entry`
  inheritance, owner/parent_entry tuple lockstep maintenance, an engine-based
  `resolveEntryCapabilities`, and a REQUIRED backfill for existing entries.
  Two open decisions raised (team/project ownership depth; backfill delivery);
  awaiting answers + `proceed`. Scope estimate revised upward
  (~16 backend / ~8 frontend / ~4 tests).
