# PLAN-002 — Unified share module (polymorphic shares table)

- **status**: completed
- **createdAt**: 2026-05-23
- **approvedAt**: 2026-05-23
- **relatedTask**: FEAT-002

## Context

Token-based sharing is implemented twice today, with a third, unrelated
mechanism mixed in:

| Mechanism | Location | Storage |
| --- | --- | --- |
| Document collaborator shares | `document.service.ts::addDocumentShare`, `document.permission.ts` | policy tuples (no table) |
| Document public links | `document.share.service.ts` | `document_public_links` |
| Drive shares | `drive.share.service.ts` (rich) | `drive_file_shares` |

Drive shares are the richer model: `shareType` (`direct` | `public_link`),
`permission` (`view`/`download`/`edit`), password, expiry, `maxDownloads` +
race-safe `downloadCount`, and folder-subtree browsing
(`resolveSubtreePath`, `listPublicShareEntries`, `accessPublicShareFile`).
Document public links are a strict subset: view-only, token + password +
expiry + `isActive`.

Integration points found:

- Routes: protected `documentRoutes`/`driveRoutes` and public
  `documentPublicRoutes`/`drivePublicRoutes`, mounted in
  `routes/protected.ts` and `routes/public.ts`.
- Public landing pages: `app/routes/drive.shared.$token.tsx`,
  `app/routes/documents.shared.$token.tsx`.
- Frontend API: share keys/hooks split across
  `shared/lib/api/drive.ts` and `shared/lib/api/documents.ts`; UI in
  `portal/-share-dialog.tsx` (24KB) and `portal/-share-lists.tsx`.
- Backup: `drive.backup.ts` includes `drive_file_shares`, but
  `document.backup.ts` **omits** `document_public_links` (latent gap).
- Registry pattern already exists (`registerBackupContribution`, policy
  resource registration) — reuse it for adapter registration.
- `-share-dialog.tsx` currently renders **both** document collaborator
  (policy) shares and document public links in one dialog. Only the
  public-link section moves to the unified API; the collaborator section
  keeps calling the existing document share endpoints.

## Proposal

Approach A: one polymorphic `shares` table + a generic share service +
per-resource adapters. No data migration (research stage, breaking changes
accepted). Collaborator/policy shares are explicitly excluded.

### Backend — new module `apps/api/src/modules/share/`

**`schema.ts`**

```ts
export const SHARE_RESOURCE_TYPES = ["document", "drive_entry"] as const;
export const SHARE_TYPES = ["direct", "public_link"] as const;
export const SHARE_PERMISSIONS = ["view", "download", "edit"] as const;

export const shares = sqliteTable("shares", {
  id: text("id").primaryKey(),
  resourceType: text("resource_type", { enum: SHARE_RESOURCE_TYPES }).notNull(),
  resourceId: text("resource_id").notNull(), // polymorphic — no DB FK; adapter validates
  token: text("token").notNull(),
  shareType: text("share_type", { enum: SHARE_TYPES }).notNull().default("public_link"),
  sharedWithUserId: text("shared_with_user_id").references(() => users.id, { onDelete: "cascade" }),
  permission: text("permission", { enum: SHARE_PERMISSIONS }).notNull().default("view"),
  password: text("password"),
  expiresAt: text("expires_at"),
  maxDownloads: integer("max_downloads"),
  downloadCount: integer("download_count").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: ..., updatedAt: ...,
}, t => [
  uniqueIndex("shares_token_idx").on(t.token),
  index("shares_resource_idx").on(t.resourceType, t.resourceId),
  index("shares_created_by_idx").on(t.createdBy),
  index("shares_shared_with_idx").on(t.sharedWithUserId),
  index("shares_share_type_idx").on(t.shareType),
  index("shares_active_expires_idx").on(t.isActive, t.expiresAt),
]);
```

**`adapter.ts`** — resource-specific behavior, registered by owning modules:

```ts
export interface ShareResolved {
  readonly name: string;
  readonly isFolder: boolean;
}
export interface ShareContent {
  readonly file: FileRow;
  readonly reference: FileReferenceRow;
}
export interface ShareAdapter {
  readonly resourceType: ShareResourceType;
  /** Allowed share types / permissions for this resource (e.g. documents: view-only public_link). */
  readonly capabilities: { shareTypes: readonly ShareType[]; permissions: readonly SharePermission[] };
  resolve(db, resourceId): Promise<ShareResolved | null>;
  /** Single-file download; absent for view-only resources. */
  openContent?(db, resourceId): Promise<ShareContent>;
  /** Folder/subtree browse; absent for non-hierarchical resources. */
  listChildren?(db, resourceId, childId: string | undefined): Promise<PublicShareListing>;
  openChildContent?(db, resourceId, childId: string): Promise<ShareContent>;
}
const registry = new Map<ShareResourceType, ShareAdapter>();
export function registerShareAdapter(a: ShareAdapter): void { ... }
export function getShareAdapter(t: ShareResourceType): ShareAdapter { ... }
```

**`share.service.ts`** — generic; the gating state machine (token resolve,
password verify, expiry/exhaustion, race-safe download increment) lives here
once, lifted from `drive.share.service.ts`. Resource specifics delegate to
the adapter: `createShare`, `listSharesForResource`, `listSent/Received/Links`,
`updateShare`, `revokeShare`, `getPublicShareMeta`, `gatePublicShare`
(returns the validated share row for resource content routes),
`reserveDownload` (race-safe counter), plus
`deleteSharesForResource(db, type, id)` for cascade cleanup.

**Management plane vs. content plane** — a key refinement found during
implementation. The **management plane** (create/list/update/revoke,
capabilities, token gate, password, expiry, inboxes) is identical across
resources and lives entirely in the share module. The **public content
plane** is genuinely resource-specific and cannot be one shape:

- documents → markdown content + navigable subtree (by short_id) + attachments
- drive → file bytes (download budget) + folder listing (by entryId)

So the share module owns identity/auth/lifecycle and a single token gate;
adapters own content rendering. The adapter exposes:

```ts
interface ShareAdapter {
  resourceType; capabilities;
  resolve(db, resourceId): Promise<{ name; isFolder } | null>;
  /** Resource-specific JSON payload after the gate passes (document: doc+subtree+attachments; drive view: meta). */
  getContent?(db, resourceId, childId): Promise<unknown>;
  /** Folder-like listing (drive folders). */
  listChildren?(db, resourceId, childId): Promise<PublicShareListing>;
  /** Resolve a downloadable file (drive file / folder child / document attachment). */
  openFile?(db, resourceId, childId): Promise<ShareContent | null>;
}
```

This keeps ONE token namespace, ONE gate, ONE management API/UI while each
resource renders its own content — not a leaky abstraction: the seam is
auth/lifecycle (shared) vs. content (per-resource).

**`share.routes.ts`** (protected) and **`share.public.routes.ts`**:

- `GET /shares/capabilities/:type` — adapter `capabilities` (allowed
  `shareTypes` / `permissions`) so the UI renders generically per resource.
- `GET/POST /resources/:type/:id/shares`
- `PATCH/DELETE /shares/:id`
- `GET /shares/received|sent|links`
- public: `GET /shared/:token` (unified meta), `POST /shared/:token`
  (gate → `adapter.getContent`), `POST /shared/:token/list`
  (gate → `adapter.listChildren`), `POST /shared/:token/download/:childId?`
  (gate → reserve → `adapter.openFile` → `buildDownloadResponse`)

**`share.backup.ts`** — `shareBackupContribution` owns `shares` (deps:
`users`; resource tables already contributed by their modules). Closes the
`document_public_links` backup gap.

**Audit** — unify to `share.created` / `share.updated` / `share.revoked`
with `resourceType` in metadata (replaces `drive.share.*` and
`document.public_link_*`).

### Adapters in owning modules

- `document/document.share-adapter.ts` — `resolve` validates the item is a
  `document`; view-only public links; `listChildren` walks the document
  subtree (mirrors existing public folder logic).
- `drive/drive.share-adapter.ts` — `resolve` validates entry; `openContent`
  / `listChildren` / `openChildContent` lift `resolveSubtreePath` &
  download logic from `drive.share.service.ts`.
- Register both in each module's `index.ts` (side-effect import, like
  backup contributions).

### Cascade cleanup (replaces lost DB FK)

Polymorphic `resourceId` has no DB-level FK to the resource, so deleting a
document/drive entry no longer cascades to its shares. Wire
`deleteSharesForResource` into the document delete and drive entry
delete/purge paths.

### Removals

- Delete `document.share.service.ts` (public-link parts) +
  `document_public_links` table + document public-link routes +
  `document.public.routes.ts` link sections that duplicate share logic.
- Delete `drive.share.service.ts` + `drive_file_shares` table +
  drive share routes + `drive.public.routes.ts`.
- Drop both tables; generate the new migration via Drizzle Kit (never
  hand-author migrations).

### Frontend — unified share entry point

The whole point: any module opens sharing the same way, so the UI is
identical everywhere. Mirror the backend adapter registry on the client.

- `shared/lib/api/share.ts` — unified types, query keys, hooks
  (`useResourceShares`, `useShareCapabilities`, `useCreateShare`,
  `useUpdateShare`, `useRevokeShare`, `useReceivedShares`, `useSentShares`,
  `useLinkShares`, `usePublicShare`, download/list helpers). Remove share
  code from `drive.ts` / `documents.ts`.
- `shared/lib/share/registry.ts` — frontend resource registry. Each module
  registers `{ resourceType, label, icon, renderPublicPreview? }`; the share
  components read this registry instead of branching on type inline. This is
  the **hook other modules call** — they only supply `resourceType` +
  `resourceId`, never their own share UI.
- `shared/components/share/use-share.ts` — `useShare()` returns
  `openShare({ resourceType, resourceId, name })`; backed by a single
  app-level `<ShareDialog>` host (one mount), so every caller gets the same
  dialog. Capabilities from `useShareCapabilities(resourceType)` drive which
  controls render (e.g. documents → view-only public link, no `direct`).
- `shared/components/share/share-dialog.tsx` — moved out of `portal/`,
  resource-agnostic, parametrized by `{ resourceType, resourceId }`.
- `shared/components/share/share-lists.tsx` — resource-agnostic; render
  `resourceType` label via the registry.
- **Document collaborator (policy) shares** stay a document-owned section;
  the unified dialog composes it via an optional
  `registry[resourceType].renderExtraSection?` slot so documents inject their
  viewer/editor grants while keeping one dialog shell. Public links flow
  through the unified API for all resources.
- Public landing — single `app/routes/shared.$token.tsx` that renders
  `registry[meta.resourceType].renderPublicPreview` (document → markdown
  viewer, drive → file/folder viewer). Remove `drive.shared.$token.tsx` and
  `documents.shared.$token.tsx`.

### Tests

Port `drive.share.service.test.ts`, `drive.permission.test.ts` (share parts),
`document.share.service.test.ts`, and the public-access tests into
`share/share.service.test.ts` + `share/share.public.test.ts`, parametrized by
adapter. Add an adapter-registry unit test.

## Risks

- **Lost FK cascade** → orphaned shares if a resource delete path is missed.
  Mitigation: explicit `deleteSharesForResource` hooks in both delete paths;
  consider an orphan sweep mirroring `file/orphan-sweep.ts` as a follow-up.
- **Polymorphic integrity** — no DB guarantee `resourceId` exists; the
  adapter `resolve` is the only validator. Bad `resourceType`/`resourceId`
  pairs must fail closed (treated as not-found).
- **Drive `direct` share access** still flows through `drive.file-permission.ts`
  — confirm direct-share permission resolution reads the new table.
- **Shared dialog split** — the document dialog mixes policy shares and
  public links; the public-link migration must not disturb the collaborator
  section.
- Single public landing must handle both viewers without regressing the
  document markdown / drive folder-browse UX.
- Breaking migration drops existing share rows (accepted — research stage).

## Scope

- Backend: new `share` module (~6 files), 2 adapters, 2 module registrations,
  delete 2 services + 2 schema tables + route sections, 1 Drizzle migration,
  backup contribution, audit event rename. ~20 files.
- Frontend: 1 new API file, rewrite dialog + lists, unify 2 landing pages
  into 1, prune share code from 2 API files, i18n key consolidation. ~10 files.
- Tests: 2 new test files porting ~4 existing suites.
- Total ~30 files. Large, multi-module, breaking.

## Alternatives

- **B — shared `share-core` primitives, keep two tables.** Lower risk, but
  schema stays fragmented and a new share type still needs a new table.
- **C — code relocation only.** Lowest risk, no schema change; does not meet
  the "easier to add share types / better unified control" goal.

Rejected in favor of A per the directive to redesign without compatibility
constraints.

## Annotations

- 2026-05-23 (user): Share module must expose a hook other modules call, so
  the share UI stays unified across modules. Response: added `GET
  /shares/capabilities/:type`, a frontend `share/registry.ts` mirroring the
  backend adapter registry, and a `useShare()` hook backed by a single
  app-level `<ShareDialog>` host — modules pass only `{ resourceType,
  resourceId }` and never own share UI. Document collaborator shares inject
  via an optional `renderExtraSection` registry slot.
