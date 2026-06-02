# Backend Correctness Audit — `apps/api`

**Dimension:** backend correctness (per-module review of `apps/api/src/modules/**` + shared API lib).
**Campaign:** `l1-w6c655lo-audit-20260602135842` · **Scope:** READ-ONLY, no code changes.

**Methods**
- `pma-cr` (TS backend / Bun pack) + `audit-context-building`: line-by-line read of every non-test module (routes + services + permission hooks + schema), judged against the shared conventions baseline (response envelope `ok/paged/err`, central `errorHandler`, global `policyMiddleware` with admin short-circuit, `parsePageQuery`).
- Parallel deep-read across 7 module groups, then **direct re-verification of every High and the highest-impact Mediums** by reading the cited source (noted as `verified` in each method line).

**Conventions baseline used to judge consistency**
- Envelope: `apps/api/src/shared/lib/api-response.ts` → `{success:true,data,meta?}` / `{success:false,error:{code,message}}`.
- Errors: `apps/api/src/shared/middleware/error-handler.ts` maps `AppError`→status, `ZodError`→422, `SQLITE_CONSTRAINT`→409, else generic 500. Throwing a non-`AppError` `Error` → opaque 500.
- Authz: `policyMiddleware` auto-gates route bindings declared via `defineResource.routes`; **`role==="admin"` short-circuits before any DB check** (`middleware.ts:194`). `authRequired`/`adminRequired`/`requirePermission`.
- No **global** rate limiter is installed (`app.ts:79-105`); only specific auth/TOTP routes call `rateLimit(...)`.

## Totals by severity

| Severity | Count |
|---|---|
| critical | 0 |
| high | 2 |
| medium | 40 |
| low | 58 |
| **total** | **100** |

> No critical (remote-unauthenticated RCE / trivial full-data-exposure) defects found. The two **High** items: **SSRF via redirect-following in the cron http-request action** (`http-request/executor.ts`) and **silent per-table data-loss in backup restore** (`restore.service.ts`). The most material **Mediums** cluster into: masked-contact PII probing via list search; secrets-at-rest + audit/error log leakage (cron config, http-request/shell response bodies); non-atomic file-reference release (ship cover, comment delete); SSRF/CSRF/IP-spoof config hardening; and pervasive missing input bounds at handler edges. Dev-phase: breaking fixes are acceptable.

---

## Shared lib & middleware (cross-cutting)

- `apps/api/src/shared/lib/client-ip.ts:42-45` — severity: medium — confidence: high
  - rationale: with `TRUST_PROXY=true` and an empty `TRUSTED_PROXY_IPS` (the documented default for that flag), forwarding headers from **any** direct peer are honored, so a client reaching the process directly forges `X-Forwarded-For` and defeats every IP-keyed limiter (rate-limit + auth lockout) and spoofs audit/log IPs. `isSpoofableProxyConfig` only warns at startup; behavior is unchanged.
  - suggested action: in production, refuse to honor forwarding headers when `TRUST_PROXY=true` but no proxy allow-list is configured.
  - method: verified — read `getClientIp` trust branches.
- `apps/api/src/shared/lib/client-ip.ts:136-141` — severity: low — confidence: medium
  - rationale: the proxy allow-list is IPv4-only (`ipv4ToInt` returns `undefined` for IPv6), so a trusted IPv6 proxy peer never matches; forwarding headers are then dropped and every IPv6-fronted client collapses onto the single proxy peer IP, breaking per-client rate limiting (one shared bucket can lock out a whole tenant).
  - suggested action: support IPv6 CIDR matching, or document that `TRUSTED_PROXY_IPS` requires an IPv4 proxy peer.
  - method: verified — followed `parseCidr`/`isAllowedPeer` for an IPv6 peer.
- `apps/api/src/shared/middleware/csrf.ts:56-66` — severity: medium — confidence: medium
  - rationale: `buildAllowedOrigins` returns `[]` when **both** `CORS_ORIGIN` and `APP_URL` are unset (allowed in prod single-user mode, see `sentinels.ts:64` which only warns), so the Origin/Referer check is skipped entirely and CSRF defense degrades to the `X-Requested-With` header plus `SameSite=Lax` cookies.
  - suggested action: in production, fail closed (reject mutating requests) when no allowed-origin list can be built.
  - method: verified — read `csrfGuard` + `buildAllowedOrigins`.
- `apps/api/src/shared/middleware/csrf.ts:6,59` — severity: low — confidence: medium
  - rationale: inbound `Referer` origin is extracted with the substring regex `/^https?:\/\/[^/]+/` instead of the URL-based `originOf()` used for `APP_URL`; scheme/host case and port differences cause a mismatch. Fail-closed (false rejection, not a bypass) but inconsistent.
  - suggested action: parse the inbound referer with `originOf()` (URL.origin) for a canonical comparison.
  - method: verified — compared the two origin-extraction paths.
- `apps/api/src/shared/middleware/rate-limit.ts:118` — severity: low — confidence: medium
  - rationale: when `MAX_ENTRIES_PER_BUCKET` is reached, `evictOldest` drops the entry closest to expiry to admit a new key; combined with the XFF-spoofing finding above, an attacker rotating spoofed IPs can churn keys and continuously evict tracked attackers' near-expiry buckets, resetting counts.
  - suggested action: mitigated by fixing the XFF-trust default; the eviction policy itself is reasonable with a real per-client IP.
  - method: read `evictOldest` + `MAX_ENTRIES_PER_BUCKET`.
- `apps/api/src/shared/lib/mime-sniff.ts:160` — severity: medium — confidence: medium
  - rationale: `image/svg+xml` is accepted because SVG sniffs as text; this is safe **only** if every download path forces `attachment`/octet-stream for SVG — a cross-module invariant not enforced here. Any route that inline-renders a stored SVG becomes stored XSS.
  - suggested action: verify `buildDownloadResponse` forces attachment for `image/svg+xml` and pin it with a regression test.
  - method: read sniff logic + the comment asserting the downstream guarantee.
- `apps/api/src/shared/lib/mime-sniff.ts:79` — severity: low — confidence: medium
  - rationale: `looksLikeText` treats any byte `>0x7F` as printable, so binary that avoids NULs and stays ≥95% high-byte is classified `text` and accepted under a `text/*` claim; the stored type (audit/quota) can be wrong.
  - suggested action: optionally require valid UTF-8 decoding; low impact since text downloads as attachment.
  - method: read the byte heuristic.
- `apps/api/src/config/sentinels.ts:64` — severity: medium — confidence: high
  - rationale: in production single-user mode with no OAuth, a missing `APP_URL` only emits a warning (returns a string, does not throw). This is the root enabler of the CSRF origin-skip above — without `APP_URL` and `CORS_ORIGIN` the CSRF guard cannot enforce origin checks.
  - suggested action: require `APP_URL` (or `CORS_ORIGIN`) in production, or have the CSRF guard fail closed when neither exists.
  - method: read warn-only branch; linked to `csrf.ts:56`.
- `apps/api/src/config/oidc-discovery.ts:38` — severity: low — confidence: medium
  - rationale: `fetchOidcDiscovery` (10s timeout, 64KB cap) performs no SSRF guard on the issuer URL; a typo/malicious `OAUTH_ISSUER` pointing at `http://169.254.169.254` is fetched at boot. Operator-controlled config, so blast radius is the operator's own misconfig.
  - suggested action: optionally block private/link-local issuer hosts in production (mirror cron's `HTTP_ACTION_ALLOW_PRIVATE` posture).
  - method: read fetch + origin-pin logic.
- `apps/api/src/shared/middleware/service-token.ts:33` — severity: low — confidence: high
  - rationale: `timingSafeEqual` is used correctly, but the `a.length !== b.length` short-circuit leaks token length via timing; negligible given min-32 random tokens. Scope is correct — a service token only unlocks its scoped route, it does not broaden policy/admin bypass.
  - suggested action: acceptable; optionally compare fixed-length HMACs to remove the length side-channel.
  - method: verified — read compare + confirmed per-route scoping.

## policy

- `apps/api/src/modules/policy/middleware.ts:194` — severity: low (by design) — confidence: high
  - rationale: every product-role `admin` short-circuits all per-object Zanzibar checks globally, with no per-resource opt-out; documented (decision 003 / policy-standard) but flagged as the single highest-impact authz property — a compromised/over-granted admin has unconditional cross-tenant object access.
  - suggested action: confirm intended; if any resource must not be admin-bypassable (e.g. confidential contacts), add a per-resource opt-out (currently impossible).
  - method: verified — read `policyMiddleware` admin branch + bypass hooks.
- `apps/api/src/modules/policy/policy.routes.ts:162-170` — severity: medium — confidence: high
  - rationale: `PATCH /policy/tuples/:id` does delete-then-create as two separate awaited calls (not in a transaction); if `createTuple` fails `validateTupleInput`, the original tuple is already deleted — a validation error silently destroys the existing grant.
  - suggested action: wrap delete+create in one transaction, or validate the new relation before deleting.
  - method: read PATCH handler + `createTuple` validation.
- `apps/api/src/modules/policy/zanzibar.engine.ts:209-291` — severity: medium — confidence: high
  - rationale: `expand()` has `MAX_DEPTH` but, unlike `check()`/`listUserResources()`, does not thread the shared `NodeBudget`; a wide tuple graph within depth fans into many recursive `expand` calls (2 DB queries each) — an unbounded-work vector on `POST /policy/expand` (admin-only, lowering severity).
  - suggested action: thread the same `NodeBudget` through `expand` and short-circuit when exhausted.
  - method: compared `check()` budget vs `expand()`.
- `apps/api/src/modules/policy/resource-group.service.ts:46,96` — severity: low — confidence: medium
  - rationale: resource-group description is stored in the `subject_relation` column; the engine treats `subject_relation IS NOT NULL` rows as userset tuples (`zanzibar.engine.ts:127`). Safe today because `__meta__` is never a checked relation, but overloading the column to carry free text is fragile.
  - suggested action: store description in a dedicated column, or document that the engine never resolves `__meta__`.
  - method: read meta encoding + engine userset scan.
- `apps/api/src/modules/policy/policy.routes.ts:394-398` — severity: low — confidence: medium
  - rationale: `GET /policy/resource-groups/:id/members` returns `[]` for a bogus id without verifying the group exists, while the add-member route verifies; inconsistent 404 (admin-only, read-only).
  - suggested action: verify group existence for a consistent 404, or document empty-list-on-missing.
  - method: compared with `getResourceGroupMembers`.

## account / auth

- `apps/api/src/modules/account/users/users.routes.ts:95-124` — severity: medium — confidence: high
  - rationale: `PUT /account/me/preferences/:key` accepts `value: z.unknown()` and stores `JSON.stringify(value)` with no size cap and no `:key` length cap — any authenticated user can write unbounded preference blobs (storage abuse).
  - suggested action: bound `key` length and serialized `value` size before the upsert.
  - method: read handler.
- `apps/api/src/modules/account/users/users.routes.ts:202-232` — severity: low — confidence: high
  - rationale: `DELETE /account/me/totp/:deviceId` (sensitive) is gated by a step-up token but, unlike the confirm route, has no `rateLimit` middleware — inconsistent with the sibling sensitive op.
  - suggested action: add `rateLimit({ bucket: "totp-stepup" })` for parity.
  - method: compared confirm vs delete.
- `apps/api/src/modules/account/auth/auth.routes.ts:682` — severity: low — confidence: high
  - rationale: `/totp/verify` calls `await c.req.json()` without the try/catch the `/login-local` handler uses; a malformed/empty body throws a raw `SyntaxError` → generic 500 instead of a clean 400.
  - suggested action: wrap `c.req.json()` and return the `INVALID_BODY` 400 envelope.
  - method: compared `/login-local` (guarded) vs `/totp/verify`.
- `apps/api/src/modules/account/auth/auth.service.ts:300` — severity: low — confidence: medium
  - rationale: `upsertSingleUser`'s fallback `or(eq(username), eq(email))` runs even when `input.email` is blank; multiple legacy rows with empty email could let it take over an unintended row (no `email_verified` gate like `upsertUser`).
  - suggested action: skip the email branch when `input.email === ""`.
  - method: compared with `upsertUser` email gate.
- `apps/api/src/modules/account/auth/auth.routes.ts:352` — severity: low — confidence: medium
  - rationale: the oauth_state cookie is deleted with `path:"/"` but set with `path: cookiePath(base)`; under a non-empty `BASE_PATH` the browser may not clear it (cosmetic — state is single-use via PKCE row consume).
  - suggested action: delete with the same `cookiePath(base)`.
  - method: compared set vs delete.
- `apps/api/src/modules/account/auth/oidc.ts:134` — severity: low — confidence: medium
  - rationale: `buildAuthorizeUrl` sends no `nonce`; the id_token `sub` is read unverified (`readIdTokenSub`). Mitigated by state+PKCE plus a userinfo `sub`-match, but there is no replay/nonce binding on the id_token itself.
  - suggested action: document the deliberate omission, or add a nonce if any flow consumes id_token claims directly.
  - method: read `buildAuthorizeUrl` + `readIdTokenSub`.
- `apps/api/src/modules/account/groups/groups.routes.ts:167-201` (→ `policy.service.ts:434-468`) — severity: low — confidence: medium
  - rationale: `addGroupMembership` does check-then-insert outside a transaction; membership rows carry `subjectRelation = null`, which SQLite treats as distinct in the UNIQUE index, so a concurrent double-add can insert a duplicate membership row.
  - suggested action: wrap check+insert in `db.transaction` (mirror `createTuple`).
  - method: read service + schema unique-index NULL semantics.

## issue / item

- `apps/api/src/modules/item/comment.routes.ts:185-211` — severity: medium — confidence: high
  - rationale: the comment-attachment upload route checks only `comment.authorId === user.id` (plus subject `canRead`) and never re-checks `perms.canPost`; an author who has since lost posting rights can still attach files, bypassing the post gate the comment-create route enforces.
  - suggested action: add `if (!perms.canPost) throw new ForbiddenError()` to the attachment-upload handler.
  - method: compared POST `/comments` vs POST `/comments/:cid/attachments`.
- `apps/api/src/modules/issue/issue.service.ts:160,305` — severity: medium — confidence: high
  - rationale: `composeIssue` does `(await ...issueDetails...get())!` with a non-null assertion; an issue item lacking its `issue_details` row (data drift / partial restore) throws a `TypeError` surfaced as an opaque 500.
  - suggested action: handle the undefined case with a typed `NotFoundError`/`AppError`.
  - method: traced create/get/update through `composeIssue`.
- `apps/api/src/modules/item/comment.service.ts:177-180` — severity: medium — confidence: medium
  - rationale: `deleteComment` does `releaseAllByOwner` then `db.delete(itemComments)` as two awaited statements (no transaction); the rationale comment only covers the orphan direction. If release partially succeeds and the row-delete fails, the comment survives with some attachment ref-counts already decremented — an observable inconsistency.
  - suggested action: make the row-delete and release atomic, or abort before dropping any ref on failure.
  - method: read the two-step body + its WAL-quirk comment.
- `apps/api/src/modules/item/comment.routes.ts:175-183,228-243` — severity: low — confidence: medium
  - rationale: comment-attachment list/download rely on subject-level `canRead`/`includeInternal` but do not independently honor a comment's `is_internal` flag the way the file-permission hook (`comment-attachment.permission.ts`) does; harmless for issues today, but a future sub-type that hides internal comments from readers would leak internal attachments here.
  - suggested action: gate internal-comment attachment list/download on `perms.includeInternal`.
  - method: cross-checked `listComments` filtering, the routes, and the file hook.
- `apps/api/src/modules/issue/issue.routes.ts:142-146` — severity: low — confidence: high
  - rationale: `status`/`priority` query params are passed unvalidated into the service (`eq(items.status, params.status)`, `priority as IssuePriority`); an invalid value silently yields zero rows instead of 422. `page`/`limit` are also hand-clamped instead of using `parsePageQuery`.
  - suggested action: validate status/priority against their enums at the edge; use `parsePageQuery`.
  - method: traced route → service filters (parameterized; not injectable).
- `apps/api/src/modules/issue/issue.routes.ts:412` — severity: low — confidence: high
  - rationale: attachment-delete audit uses `resourceId: c.req.param("id")` while every sibling uses the resolved `issueShort`; works only because they happen to be equal — latent inconsistency.
  - suggested action: use the resolved `issueShort`.
  - method: cross-read all audit calls.
- `apps/api/src/modules/issue/issue.service.ts:377-394` — severity: low — confidence: medium
  - rationale: `softDeleteIssue` selects the item without an `isNull(deletedAt)` filter, then runs the tuple-delete branch even for already-deleted issues (idempotent but redundant).
  - suggested action: early-return when already soft-deleted.
  - method: compared select vs update filters.
- `apps/api/src/modules/item/item.service.ts:405-407` — severity: low — confidence: medium
  - rationale: `listPinnedByProject` merges issue+procurement sets and sorts in JS by string-comparing `pinnedAt` (coalescing NULL→""), with unbounded `.all()` queries; fine while pinned sets are small, an in-memory N-row sort otherwise.
  - suggested action: push ORDER BY/LIMIT into a UNION query if pinned sets can grow.
  - method: read the two queries + JS merge.
- `apps/api/src/modules/issue/references.service.ts:112-119` — severity: low — confidence: medium
  - rationale: `addReference` accepts any `refId` for `worklist` refs with no existence/scope check (soft reference by design), so a worklist reference can point at a non-existent or cross-scope worklist; resolution degrades to `null`.
  - suggested action: confirm soft-reference semantics; validate reachability if cross-scope linkage matters.
  - method: read schema (no FK) + resolver.

## project / ship

- `apps/api/src/modules/ship/ship.service.ts:445-466, 469-487, 395-412` — severity: medium — confidence: high
  - rationale: `setShipCover`, `removeShipCover`, and `softDeleteShip` repoint/clear the cover with a plain `db.update` and then `await releaseReference(...)` as a **separate** statement — non-atomic. The project module fixed exactly this (F4) by calling `releaseReferenceTx(tx, prev)` **inside** the `db.transaction` and finalizing the blob after commit (`project.service.ts:541-548,569-576`). A crash between the cover write and the release leaks the previous file reference (ref-count never decremented; GC cannot reclaim a still-referenced row).
  - suggested action: move reference release into the same transaction via `releaseReferenceTx`, then `finalizeReleasedBlob` after commit — mirror `setProjectCover`/`removeProjectCover`.
  - method: verified — read ship cover paths and compared against the project F4 pattern.
- `apps/api/src/modules/project/project.service.ts:712-728` — severity: medium — confidence: medium
  - rationale: `addMember` inserts `input.roleId` with no check that the role belongs to `projectId` (the FK `role_id → project_roles.id` is not project-scoped). The route validates the role, but the function is exported; any future/other caller could create a cross-project role binding that `getMemberCapabilities` then reads. `updateMember` (`:771`) has the same route-only guard.
  - suggested action: re-validate `roleId` via `resolveRole(db, projectId, roleId)` inside `addMember`/`updateMember`.
  - method: verified — read both functions; only the route scopes the role.
- `apps/api/src/modules/project/project.service.ts:444-461` — severity: low — confidence: medium
  - rationale: `updateProject`'s UPDATE `where` is `eq(projects.id, …)` (+ optional version) with no `isNull(projects.deletedAt)`; between the `getProjectByShortId` read and the write, a concurrent soft-delete can be silently overwritten (resurrecting `updatedAt`/`version` and writing fields on a deleted row).
  - suggested action: add `isNull(projects.deletedAt)` to the update `where`.
  - method: verified — compared read filter vs update `where`.
- `apps/api/src/modules/ship/ship.routes.ts:42` — severity: medium — confidence: high
  - rationale: `shipCoreShape.tags` is `z.array(z.string()).optional()` with no per-tag length cap and no array-size cap, unlike project's `z.array(z.string().min(1).max(50)).max(50)`; unbounded tag count/length flows into `syncResourceTagsTx`.
  - suggested action: mirror the project tag bound.
  - method: diffed ship vs project tag schemas.
- `apps/api/src/modules/ship/ship.service.ts:366-385` — severity: medium — confidence: medium
  - rationale: `updateShip` bumps `version` but never checks it (no `expectedVersion`), unlike `updateProject`; concurrent ship edits silently last-writer-wins despite the version column existing.
  - suggested action: add an `expectedVersion` guard mirroring `updateProject`, or document that ships don't support optimistic concurrency.
  - method: compared `updateShip` vs `updateProject`.
- `apps/api/src/modules/project/project.service.ts:147` — severity: medium — confidence: high
  - rationale: `loadCoverUrlsByReference` selects `fileReferences` by id with no `ownerType` filter, so it will emit a content URL for any reference type if `coverReferenceId` is ever set incorrectly; defense-in-depth gap (not exploitable today).
  - suggested action: constrain to expected cover owner types, or document the invariant.
  - method: read the query.
- `apps/api/src/modules/project/project.roles.ts:159` — severity: low — confidence: high
  - rationale: `createRole` does not enforce a unique role name per project; two roles named "Writer" can coexist, which confuses the backfill's name-based preset detection.
  - suggested action: add a `(projectId, name)` unique index or pre-check.
  - method: read `createRole`; no unique index in schema.
- `apps/api/src/modules/project/project.roles.ts:274-372` — severity: low — confidence: medium
  - rationale: `backfillProjectRoles` loads the roles snapshot outside the transaction and mutates inside it using that stale list; a concurrent boot or a pre-existing custom "Reader" plus a renamed Member could still create a duplicate preset role.
  - suggested action: re-read roles inside the tx, or add the `(projectId,name)` unique index.
  - method: traced snapshot vs tx mutations.
- `apps/api/src/modules/project/project.roles.ts:190-191` — severity: low — confidence: high
  - rationale: `updateRole` silently returns the unchanged row for system roles; the route then responds 200 with an unmodified role, so editing Owner/Guest caps reports success but does nothing.
  - suggested action: return a "system" sentinel like `deleteRole` so the route can 403.
  - method: read the early-return.
- `apps/api/src/modules/project/project.routes.ts:278` — severity: low — confidence: high
  - rationale: project `listSchema.q` has no `.max()` (ship caps `q` at 200); unbounded `q` feeds a `LIKE` pattern (escaped — not injectable, but unbounded and inconsistent).
  - suggested action: add `.max(200)` to match ship.
  - method: diffed project vs ship list schemas.
- `apps/api/src/modules/ship/ship.worklist.service.ts:142-157` — severity: low — confidence: high
  - rationale: the from-scratch `createShipWorklist` path uses `name = input.name ?? ""`; the route schema rejects empty names, but the exported service inserts `""` (NOT NULL satisfied) for a direct caller passing neither `name` nor `fromGlobalId`.
  - suggested action: validate non-empty `name` in the service, not only in the route schema.
  - method: traced `name` fallback vs insert. (Note: `worklistRoutes()` admin gating and ship/global separation via `isNull(shipId)` were verified correct.)

## contact / procurement / tag

- `apps/api/src/modules/contact/contact.service.ts:188-190` — severity: medium — confidence: high
  - rationale: the list `q` search matches on `contactPerson` and `note` — fields that `composeWithCapabilities` masks for non-privileged actors — so for a **public + confidential** contact (visible by name, fields masked) an actor can probe substrings of the hidden `contactPerson`/`note` character-by-character via search hit/miss, even though the value is never returned.
  - suggested action: for non-privileged actors restrict the `q` predicate to always-visible fields (`name`), or exclude rows whose fields would be masked.
  - method: verified — cross-referenced search columns vs `canSeeConfidentialFields` masking.
- `apps/api/src/modules/contact/contact.service.ts:214-221` — severity: medium — confidence: high
  - rationale: the list loops per row calling `resolveContactCapabilities` (up to two `check()` engine queries each) **and** `composeWithCapabilities` (another `check()` + a tag query) — an N+1 across Zanzibar/tag lookups on every paginated row.
  - suggested action: batch tags via `loadResourceTagsByResource` and precompute the explicit-viewer id set once (as procurement does), avoiding per-row engine calls.
  - method: verified — read the loop + `composeWithCapabilities`.
- `apps/api/src/modules/contact/contact.service.ts:165-221` — severity: medium — confidence: medium
  - rationale: the SQL visibility `where` for non-admins is `or(eq(ownerId), eq(visibility,'public'), inArray(viewer ids from listUserResources))`, but `resolveContactCapabilities` additionally grants access via **owner tuples** (`check(...,"owner",...)`) and group-derived viewer grants. Contacts reachable only through those are omitted from the list (under-inclusion), and the pagination `total` (a `count()` over the SQL `where`) reflects the SQL filter, not capability resolution — so the list can diverge from what a single-`GET` would allow. (Corrects an earlier "total too high" read: in practice every `where`-matched row yields `caps>0`, so the divergence is missing rows, not phantom counts.)
  - suggested action: make the SQL `where` authoritative for visibility (include owner-tuple/group grants), or accept and document the list-vs-detail divergence.
  - method: verified — compared the SQL `where` to `resolveContactCapabilities` + the `caps.size===0` drop.
- `apps/api/src/modules/contact/contact.routes.ts:167-195` — severity: medium — confidence: high
  - rationale: `GET /contacts` and `POST /contacts` are not in `contactAccess.routes`, so `policyMiddleware` passes them through; `POST /contacts` lets any authenticated user create a global contact with no resource/role gate.
  - suggested action: confirm "any authenticated user may create global contacts" is intended; if not, add a permission gate.
  - method: verified — `contactAccess.routes` covers only `:id` routes.
- `apps/api/src/modules/procurement/procurement.service.ts:51-60` (+ `:172,:278`) — severity: medium — confidence: high
  - rationale: `assertSupplierExists` validates only that the supplier contact exists globally via `resolveGlobalContact` (no access check), so a project manager can attach a confidential/private contact they cannot see as a supplier; its id is then returned on every procurement row to all project members (existence/IDOR leak).
  - suggested action: resolve the supplier through the capability-aware contact accessor, or restrict suppliers to non-confidential contacts.
  - method: verified — read `assertSupplierExists` → `contact.service.resolve` (no caps check).
- `apps/api/src/modules/procurement/procurement.routes.ts:143-150` — severity: medium — confidence: high
  - rationale: list params `q`, `status`, `priority`, `categoryId` are passed straight from `c.req.query` into the service with no zod/length validation (only `tagIds` is bounded); `q` is unbounded LIKE input and invalid status/priority are silently dropped instead of 422'd.
  - suggested action: validate the query with a zod schema (bounded `q`, enum status/priority).
  - method: read route vs service.
- `apps/api/src/modules/tag/tag.routes.ts:35-43` — severity: medium — confidence: high
  - rationale: `PATCH /tags/:id` takes `type` from the request body and scopes the rename by `(id, type)`; a wrong `type` just no-ops as not-found, masking client errors. The body `type` is a redundant foot-gun versus deriving it from the tag row.
  - suggested action: derive `type` from the tag id, or 422 on mismatch.
  - method: read route → service.
- `apps/api/src/modules/tag/tag.service.ts:80-90` — severity: medium — confidence: high
  - rationale: `createTag` is check-then-insert with no transaction; concurrent creators race past the existence check and the unique `(type,name)` index then surfaces a generic 409 instead of the intended "Tag name already exists" 422.
  - suggested action: catch the unique-constraint error and re-map to `ValidationError`, or document the 409.
  - method: read create path vs `tags_type_name_idx`.
- `apps/api/src/modules/contact/contact.permission.ts:69-77` — severity: low — confidence: medium
  - rationale: `canSeeConfidentialFields` returns `true` for any actor whenever the contact is not `(public && confidential)`, so it relies entirely on upstream gating to never call `compose` for an unauthorized actor; the name implies stronger protection than it gives.
  - suggested action: default-deny (return false unless owner/viewer/admin or public-non-confidential).
  - method: verified — evaluated the boolean for a stranger/private/non-confidential contact.
- `apps/api/src/modules/contact/contact.routes.ts:172-179` — severity: low — confidence: high
  - rationale: `status` is validated by a manual `includes` cast and `page`/`limit` are hand-clamped instead of zod + `parsePageQuery`; invalid `status` silently becomes `undefined` rather than 422.
  - suggested action: validate with `z.enum(CONTACT_STATUSES)` and use `parsePageQuery`.
  - method: read inline validation.
- `apps/api/src/modules/procurement/procurement.service.ts:294,369` — severity: low — confidence: medium
  - rationale: `version: sql\`${items.version}+1\`` is incremented on every procurement update/status-change with no optimistic-concurrency `where version = ?`; concurrent updates silently last-writer-wins.
  - suggested action: add a version guard if the column is meant for locking, else document it as display-only.
  - method: read update/changeStatus.
- `apps/api/src/modules/procurement/procurement.service.ts:36-45` — severity: low — confidence: medium
  - rationale: `ulidTimestamp` recomputes `createdAt` by decoding the ULID prefix; a non-ULID `items.id` (legacy/imported) silently returns "now" instead of surfacing the data issue.
  - suggested action: persist a real `createdAt` column, or return null on decode failure.
  - method: read the decoder fallback.
- `apps/api/src/modules/tag/tag.service.ts:122-128` — severity: low — confidence: high
  - rationale: `deleteTag` checks `(id,type)` in the prior select but the DELETE keys only on `id`; correct (id is PK) but should mirror the `(id,type)` scope for defense in depth.
  - suggested action: add `eq(tags.type, type)` to the delete `where`.
  - method: read the delete.
- `apps/api/src/modules/tag/tag.service.ts:161-179` — severity: low — confidence: medium
  - rationale: `syncResourceTagsTx` dedups case-insensitively while `upsertTagIdTx` looks up by exact name against a case-sensitive unique index, so "Foo" and "foo" can coexist as separate vocabulary tags while per-resource sync collapses them.
  - suggested action: pick one casing policy (normalized vocabulary unique on `lower(name)`, or case-sensitive dedup).
  - method: compared dedup key vs exact-match upsert vs index.

## document / drive / file / share

- `apps/api/src/modules/drive/drive.file-permission.ts:5-34` — severity: medium — confidence: high
  - rationale: the registered `drive_entry` file-permission hook authorizes `canRead`/`canDelete` only when `ownerType="user" AND ownerId=actor.id` (plus admin); it silently denies `team_directory` and `project`-owned entries and ignores direct shares. Through the generic `GET /files/:id/content?ref=...` path a legitimate team/project member is 404'd. Fail-closed (no escalation) but a real functional bug, and inconsistent with `resolveEntryCapabilities`.
  - suggested action: reuse `resolveEntryCapabilities` in the hook so team/project/share access is honored consistently.
  - method: verified — compared the hook's owner-only check to `resolveEntryCapabilities`.
- `apps/api/src/modules/drive/drive.permission.ts:100-116` — severity: medium — confidence: medium
  - rationale: the direct-share capability query filters `isActive = 1` only — it ignores `expiresAt`/`maxDownloads`, so an expired/exhausted direct share still confers `read`/`download`/`update` through the authenticated drive routes, unlike the public gate which enforces expiry.
  - suggested action: add `expiresAt` (and exhaustion) checks to the direct-share capability query, or document that direct shares ignore expiry.
  - method: verified — read the share query; precondition is that direct shares carry expiry.
- `apps/api/src/modules/share/share.public.routes.ts` (whole router) — severity: medium — confidence: high
  - rationale: the unauthenticated `POST /shared/:token` (password verify) and `/download` endpoints have **no** rate limiting (none in the share module, and no global limiter), so a password-protected share token can be brute-forced and download budgets probed at network speed.
  - suggested action: apply `rateLimit({ bucket: "share-public" })` (keyed by IP) to the public share router.
  - method: verified — `grep` confirms no `rateLimit` in `share/` or `routes/public.ts`; `app.ts` installs no global limiter.
- `apps/api/src/modules/drive/drive.service.ts:736` — severity: medium — confidence: high
  - rationale: `throwDuplicateName` detects duplicates by substring-matching `err.message.includes("UNIQUE constraint failed")`, so a UNIQUE violation on a *different* index (e.g. a `drive_file_versions` version race) is reported to the user as "drive entry name already exists".
  - suggested action: match the specific index name, or pass constraint context.
  - method: read `throwDuplicateName` + call sites.
- `apps/api/src/modules/document/document.service.ts:124,236,709` — severity: medium — confidence: high
  - rationale: `createDocument`/`updateDocument`/`addDocumentShare` throw raw `new Error("… not found")` instead of `NotFoundError`; the central handler maps unknown `Error` to a generic **500**, so a bad `parentId`/document id returns 500 instead of 404 (reachable via `moveDocument`, direct callers, or a TOCTOU delete race).
  - suggested action: throw `NotFoundError`.
  - method: read the three throw sites + handler fallthrough.
- `apps/api/src/modules/file/file.service.ts:166` — severity: medium — confidence: high
  - rationale: the blob is `driver.put` before the Phase-3 `files`-row transaction; if `put` succeeds but the process dies before the row is written, a disk-only orphan exists that GC (which scans `files.ref_count = 0`) can never see or reclaim.
  - suggested action: accept (documented) but note GC cannot reclaim a row-less blob — a disk-vs-DB reconciliation sweep would be needed.
  - method: read the 3-phase upload + `listUnreferencedFiles`.
- `apps/api/src/modules/drive/drive.service.ts:655` — severity: medium — confidence: medium
  - rationale: `collectEntryTreeIds` does an unbounded BFS of repeated `inArray(parentEntryId, frontier)` queries with no depth/cycle guard; a corrupted/imported parent cycle loops forever, and it is an N-query-per-level pattern used in trash/restore/delete.
  - suggested action: add a visited-set/max-depth guard, or use a recursive CTE.
  - method: read the BFS loop.
- `apps/api/src/modules/file/storage/local.ts:79` — severity: low — confidence: high
  - rationale: `resolveKey` rejects absolute keys and `..` segments before `resolve(localRoot, …)`, but does not re-assert the resolved path stays under `localRoot`; keys are hex-derived so it cannot fire today, but the guard is the only defense.
  - suggested action: after `resolve`, assert the result starts with `localRoot + sep`.
  - method: verified — traced `deriveStorageKey` (hex) → `resolveKey`.
- `apps/api/src/modules/file/file.service.ts:556` — severity: low — confidence: medium
  - rationale: GC and sync release both call the process-global `decrementUploadsUsed`; the DB row delete is guarded by `eq(refCount,0)` (no DB double-free), but the in-memory quota counter is not transactional and can drift under a DEK-rotation/db-swap race.
  - suggested action: recompute quota usage from SQL periodically, or make it authoritative.
  - method: read `deleteUnreferencedFile`/`syncDeleteBlob`/quota counter.
- `apps/api/src/modules/file/orphan-sweep.ts:47` — severity: low — confidence: high
  - rationale: `listOrphanReferences` interpolates `rule.parentTable`/`parentKey` via `sql.raw`; safe because `ORPHAN_RULES` is a static const, but it becomes an injection vector if that ever turns dynamic.
  - suggested action: keep `ORPHAN_RULES` static; add an allowlist assertion/comment.
  - method: confirmed `ORPHAN_RULES` is module-level const.
- `apps/api/src/modules/share/share.service.ts:361` — severity: low — confidence: high
  - rationale: `reserveDownload` re-checks `isActive` and budget inside its tx but not `expiresAt`; between the gate and the reservation a link can expire yet still consume one download.
  - suggested action: re-read `expiresAt` inside the reservation tx and bail if expired.
  - method: compared `gatePublicShare` (expiry) vs `reserveDownload`.
- `apps/api/src/modules/drive/drive.share-adapter.ts:147` — severity: low — confidence: medium
  - rationale: a `download`/`edit` folder public-link lets any child in the subtree be downloaded; combined with the missing rate limit this enables bulk subtree exfiltration. Likely intended scope, but worth confirming.
  - suggested action: confirm folder-link download scope; ensure rate limiting bounds bulk exfiltration.
  - method: traced `openFile` both branches + `resolveSubtreePath`.
- `apps/api/src/modules/document/document.service.ts:679` — severity: low — confidence: medium
  - rationale: `listDocumentSharesWithInheritance` sorts with an O(n) `ancestorIds.find` inside the comparator (O(n² log n)); bounded today but a latency cliff for deep trees with many shares.
  - suggested action: precompute a `shortId → depth` map before sorting.
  - method: read the comparator.
- `apps/api/src/modules/share/share.service.ts:124` — severity: low — confidence: medium
  - rationale: "one active public link per resource" is enforced by check-then-insert with no matching unique DB constraint, so two concurrent creates can both succeed.
  - suggested action: accept (UI-driven) or add a partial unique index.
  - method: read `createShare`; no matching unique index.

## cron / backup / audit

- `apps/api/src/modules/cron/actions/http-request/executor.ts:191-194,224` — severity: high — confidence: high
  - rationale: the `RequestInit` sets no `redirect`, so `fetch` defaults to `redirect:"follow"`. The DNS-pin + `isPrivateDestination` check only vets the **first** hop; a vetted public URL that returns a 30x to `http://169.254.169.254/…` (cloud metadata) or an internal host is then fetched **without re-validation** — an SSRF bypass of the private-IP guard.
  - suggested action: set `redirect:"manual"` (or `"error"`) and re-run `isPrivateDestination` on any `Location` host before following.
  - method: verified — `init` has no `redirect` field; Bun `fetch` follows by default.
- `apps/api/src/modules/backup/restore.service.ts:334-342` — severity: high — confidence: high
  - rationale: the restore transaction deletes **every** table in `deleteOrder` (driven by the uploaded `modules`) but inserts only tables present and non-empty in `data.tables`. A backup that lists a module but omits/empties one of its table keys (truncated/partial/hand-edited upload) silently wipes that live table with nothing restored — destructive, input-driven data loss.
  - suggested action: only delete tables that have a corresponding rowset in the backup, or validate the payload is complete-by-module before deleting.
  - method: verified — read the unconditional `for (table of deleteOrder) tx.delete(table)` vs the `if (!rows||!rows.length) continue` insert loop.
- `apps/api/src/modules/backup/export.routes.ts:37` — severity: medium — confidence: high
  - rationale: `/backup/export-via-token` streams the entire unlocked DB (incl. `users`, `audit_events`, and cron task configs holding secrets) to any holder of the backup service token, bypassing the session/DEK challenge; the compare is constant-time but a single static bearer = full plaintext DB exfiltration with no module scoping.
  - suggested action: scope the token to specific modules and/or pair it with network ACLs; redact secret-typed fields; document the blast radius.
  - method: verified — route calls `streamJsonBackup(db, [...getModuleNames()])` (all modules).
- `apps/api/src/modules/cron/cron.routes.ts:175,204` (+ `serialize.ts:57-64`) — severity: medium — confidence: high
  - rationale: job `config` (incl. http-request `headers` with Bearer tokens and `secret`-typed inputs) is persisted as plaintext in `cron_jobs.task_config`, and `serializeJob` returns the full parsed `taskConfig` in GET responses — secrets stored unencrypted and echoed to any admin listing jobs (the `secret` input type is UI-masking only).
  - suggested action: encrypt secret-typed fields at rest (or store a secret ref) and redact them in `serializeJob`.
  - method: verified — traced config → row → `serialize.ts` returns `JSON.parse(row.taskConfig)` verbatim.
- `apps/api/src/modules/cron/actions/http-request/executor.ts:250-252` — severity: medium — confidence: high
  - rationale: on an unexpected status the thrown error embeds up to 2048 bytes of the target's response body, which lands verbatim in `cron_job_logs.error` and the trigger HTTP response — a target reflecting tokens/secrets leaks them into stored logs.
  - suggested action: keep status + duration in the persisted error; drop the body (or gate it behind a debug flag).
  - method: verified — followed thrown Error → log/response.
- `apps/api/src/modules/cron/actions/soft-delete-cleanup/executor.ts:48` — severity: medium — confidence: high
  - rationale: `Number(config.olderThanDays)` on a bad/hand-edited value yields `NaN`; `NaN > 0` is false, so `cutoffIso` stays null and the action hard-deletes **every** soft-deleted job regardless of the intended grace window.
  - suggested action: reject non-finite `olderThanDays` (throw) instead of falling back to "purge everything".
  - method: read the `Number(...)` → cutoff-null → unconditional delete path.
- `apps/api/src/modules/cron/executor.ts:95` — severity: medium — confidence: high
  - rationale: the initial `cron_job_logs` insert sits outside the `try`; if that insert throws (DB closed during shutdown drain, constraint), the run is silently lost — no `failed` log row, no auto-pause accounting.
  - suggested action: wrap the initial insert; on failure log a distinct event and return without corrupting the failure streak.
  - method: read insert (95) preceding the `try` (102).
  - related: `apps/api/src/modules/cron/executor.ts:174` — `maybeAutoPause` streak can skew when a manual trigger (bypasses overrun protection by design) interleaves with a scheduled tick — low/medium, medium confidence.
- `apps/api/src/modules/cron/actions/shell/executor.ts:88` — severity: medium — confidence: high
  - rationale: timeout detection `code === 137 && durationMs+50 >= timeoutMs` is heuristic — a legit exit 137 (OOM / `exit 137`) inside the window is misreported as a timeout, and a SIGKILL slightly faster than `timeoutMs` as a normal failure; the `timedOut` flag is unreliable.
  - suggested action: set a `timedOut` boolean inside the `setTimeout` callback instead of inferring from exit code + elapsed time.
  - method: read timer/exit logic.
- `apps/api/src/modules/backup/restore.service.ts:269` — severity: medium — confidence: medium
  - rationale: `reconcileRestoredFiles` treats **any** blob-probe error as "absent" and zeroes `ref_count`, so a transiently-unreadable backend detaches live file references.
  - suggested action: distinguish "probe error" from "confirmed absent" before zeroing `ref_count`.
  - method: read reconcile catch → `present=false`.
- `apps/api/src/modules/audit/audit.service.ts:28` — severity: medium — confidence: high
  - rationale: `audit()` swallows all insert errors (catch → log → return undefined); callers (incl. backup export/import, user restore) ignore the return, so a destructive action can complete with **no** audit trail — for a security log, silent loss of the record of a destructive action is a correctness gap.
  - suggested action: for high-sensitivity actions propagate/alert on audit-write failure; keep best-effort only for routine events.
  - method: verified — read the catch + callers ignore the result.
- `apps/api/src/modules/cron/actions/http-request/executor.ts:212-214` — severity: low — confidence: medium
  - rationale: in the allow-private / IP-literal path a caller-supplied `Host` header in `cfg.headers` is passed straight to `fetch` (the pinned path overwrites it), enabling Host-header injection / cache poisoning against internal services when `HTTP_ACTION_ALLOW_PRIVATE=true`.
  - suggested action: strip/validate a caller-supplied `Host`, or document that allow-private trusts the full header set.
  - method: compared pinned vs non-pinned header handling.
- `apps/api/src/modules/cron/actions/http-request/executor.ts:234` — severity: low — confidence: high
  - rationale: `await res.text()` buffers the entire response body before truncating to the 2048-byte preview; the cap protects the log, not memory — a multi-GB response is fully buffered.
  - suggested action: stream-read and stop after the preview byte budget, or enforce a Content-Length ceiling.
  - method: read the body-preview block.
- `apps/api/src/modules/cron/actions/shell/executor.ts:100` — severity: low — confidence: high
  - rationale: on non-zero exit the thrown error embeds up to 4096 bytes of raw `stderr` → persisted in `cron_job_logs.error` and the trigger response (internal paths/secrets on stderr leak to admins).
  - suggested action: keep the persisted error generic; stderr already goes to the process logger.
  - method: read stderr → thrown Error.
- `apps/api/src/modules/cron/cron-format.ts:73` — severity: low — confidence: medium
  - rationale: `isValidCron` delegates to `Cron.isValid(...)`; if the library throws (rather than returning false) on a pathological expression, the create route surfaces an unhandled 500 instead of a 400 `INVALID_CRON`.
  - suggested action: wrap `Cron.isValid` in try/catch returning false.
  - method: read `isValidCron` (no guard around the library call).
- `apps/api/src/modules/cron/cron.routes.ts:204` — severity: low — confidence: medium
  - rationale: `createJobSchema.config` is `z.record(z.string(), z.unknown())` with no size/depth cap, JSON.stringify'd; executors use `.passthrough()`, so unknown attacker-controlled keys persist and bloat every parse.
  - suggested action: cap config size and strip keys not in the action's `inputs[]`.
  - method: read schema + insert + executor passthrough.
- `apps/api/src/modules/backup/restore.service.ts:378-383` — severity: low — confidence: high
  - rationale: if a batch insert throws but the per-row replay all succeed, the code still falls through to `throw AppError(...)` ("succeeded somehow"), aborting an import that actually replayed cleanly — a recoverable batch-level error becomes a hard failure.
  - suggested action: if per-row replay fully succeeds, continue rather than throw.
  - method: verified — read batch catch → row replay → unconditional throw.
- `apps/api/src/modules/backup/restore.service.ts:107` — severity: low — confidence: medium
  - rationale: `assertIdShape` only validates `id`/`*Id`/`*_id` fields; `validateRowShape` checks key names, not values — a malicious backup can set arbitrary `storage_key`/`storage_driver` on `files` rows (exploitable only if a driver later joins it to a filesystem path).
  - suggested action: validate `storage_key` against an allowed key alphabet on restore.
  - method: read `assertIdShape` filter.
- `apps/api/src/modules/backup/restore.service.ts:396-397` — severity: low — confidence: medium
  - rationale: `reconcileRestoredFiles` runs after COMMIT; a crash between COMMIT and reconcile leaves restored `files` rows un-quarantined, so their downloads 500 (the failure the design intends to prevent).
  - suggested action: keep reconcile idempotent on re-run; document that a crash here needs a manual reconcile pass.
  - method: read the post-commit await.
- `apps/api/src/modules/backup/export.routes.ts:91-106` — severity: low — confidence: medium
  - rationale: the in-flight / last-success maps are keyed by `token.slice(0,8)` (two tokens sharing an 8-char prefix collide) and grow unbounded across distinct tokens; the success timestamp is also set before the stream drains, contradicting the min-interval intent.
  - suggested action: key by a full-token hash; set last-success in the stream `finally`.
  - method: read `tokenBucketKey` + ordering.
- `apps/api/src/modules/backup/export.service.ts:99` — severity: low — confidence: medium
  - rationale: keyset pagination casts the PK to `String(rows[...].id)` with `gt(idColumn, cursor)`; safe for the current string ULID/nanoid ids but skips/duplicates rows if a table's id is numeric or lexically-vs-numerically ordered differently.
  - suggested action: require/assert string PKs, or use the column's native type for the cursor.
  - method: read the cursor logic.
- `apps/api/src/modules/cron/actions/log-cleanup/executor.ts:11` — severity: low — confidence: high
  - rationale: cleanup iterates all jobs issuing per-job count+delete with no transaction; correctness fine, but O(jobs) round-trips on large fleets.
  - suggested action: batch with a windowed `DELETE … WHERE id NOT IN (newest N)` per job.
  - method: read the loop.
- `apps/api/src/modules/audit/retention.ts:34-38` — severity: low — confidence: high
  - rationale: `pruneAuditEvents` relies on `res.changes` via a runtime cast of drizzle's `db.run` (typed `void`); if the adapter ever stops threading `changes`, `affected` is 0, the loop breaks immediately and retention silently stops pruning.
  - suggested action: add a test asserting `changes` is present, or count via a follow-up SELECT.
  - method: cross-checked the `RunResult` cast vs the loop break.
- `apps/api/src/modules/audit/audit.service.ts:73` — severity: low — confidence: medium
  - rationale: the `action` filter's `".*"` wildcard becomes `like("${prefix}%")` without escaping `%`/`_`, so values like `a_b` match more rows than intended (over-match, not injection — drizzle parameterizes the value).
  - suggested action: escape `%`/`_` in the LIKE pattern or document the wildcard.
  - method: read the filter branch.

## settings / search / system

- `apps/api/src/modules/settings/settings.service.ts:15` — severity: medium — confidence: high
  - rationale: sensitive-key masking is suffix-based (`.secret`, `.token`, …); a sensitive value stored under a key not ending in a listed suffix (e.g. `oauth.clientSecretValue`, `smtp.pass`) is returned in plaintext by `GET /settings` and `GET /settings/:key`, and the wildcard write lets an admin create such keys freely.
  - suggested action: enforce the schema comment's "runtime secrets live in env, not settings", or move secrets out of the generic settings table; at minimum document the suffix contract.
  - method: read `isSensitiveKey` + the two GET routes.
- `apps/api/src/modules/settings/settings.routes.ts:24` — severity: medium — confidence: high
  - rationale: `putSettingSchema` validates only `value: z.string().min(1)` with no upper length bound (DB column is `TEXT NOT NULL`); an admin can write unbounded blobs that `getSettings`/`maskSensitiveValue` then read into memory on every settings list.
  - suggested action: add `.max(N)` (e.g. 64KB) to the settings value.
  - method: verified — read schema + the broad read path.
- `apps/api/src/modules/settings/settings.routes.ts:88,120` — severity: low — confidence: high
  - rationale: the change/delete audit calls `getClientIp(c)` with no config arg, so it ignores `TRUST_PROXY` and records the proxy IP even in correctly-proxied deployments — inconsistent with rate-limit/auth which pass config.
  - suggested action: pass `c.get("config")` to `getClientIp` here.
  - method: compared call sites.
- `apps/api/src/modules/settings/settings.routes.ts:21` — severity: low — confidence: medium
  - rationale: a malformed setting key throws `NotFoundError` (404) rather than 400/422 — semantically odd for a bad request (not a security issue).
  - suggested action: return 400 for malformed keys.
  - method: read `validateSettingKey`.
- `apps/api/src/modules/search/search.service.ts:48-50` — severity: low — confidence: medium
  - rationale: `resolveDriveOwners` caps project enumeration at `limit:100`, so a user in >100 projects silently misses drive-search owners beyond the first 100 (completeness gap, not a leak).
  - suggested action: paginate or raise the cap for owner resolution, or document the ceiling.
  - method: read `listProjects({memberUserId, limit:100})`. (Search scoping itself verified correct: documents by visibility, issues/projects/ships by membership for non-admins, drive by owner — no cross-tenant leak; LIKE terms parameterized with `ESCAPE '\\'`.)
- `apps/api/src/modules/search/search.routes.ts:14` — severity: low — confidence: high
  - rationale: `q` length is uncapped (only feeds parameterized LIKE); empty `q` returns early, so low risk.
  - suggested action: optionally cap `q` length (e.g. 256) to avoid pathological LIKE scans.
  - method: read the limit clamp + service guard.
- `apps/api/src/modules/system/system.routes.ts:16` — severity: low — confidence: high
  - rationale: `/health/ready` returns `{status:"db_unavailable"}` to unauthenticated callers, mildly leaking DB-health state; `/system/version` and `/system/upload-limits` are correctly behind auth/admin, and `/metrics` behind `serviceTokenRequired`.
  - suggested action: optional — return a bare 503 with no body discriminator.
  - method: verified — read each public-route handler; no build/version/env leak.

---

## Verified-correct (non-findings, for reviewer confidence)

- **Admin short-circuit & `authRequired` idempotency** behave as documented; the boot-time assertion (`app.ts:136`) fails closed if no policy bindings register.
- **SQL injection**: no string-interpolated SQL found; Drizzle parameterizes everywhere, LIKE patterns use `escapeLike` + explicit `ESCAPE '\\'`, `sql.raw` is used only with static identifiers (`orphan-sweep.ts`, `restore` reconcile).
- **Path traversal**: `storage/key.ts` keys are hex-only; `resolveKey` blocks `..`/absolute; `static.ts` serves from a precomputed `Map` (no fs path join from input); `content-disposition.ts` strips control chars and uses `encodeURIComponent` for `filename*` (no CRLF injection).
- **SQLite hardening** (`db/index.ts`): `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout`, `synchronous=NORMAL`; migration guards fail fast on empty/corrupt embedded migrations.
- **Passwords/tokens**: `Bun.password` (argon2id) for share + login; `serviceTokenRequired` and step-up use `timingSafeEqual`; share tokens are `nanoid(10)` (~51.7 bits).
- **Restore transaction** is correctly kept synchronous so ROLLBACK works on a failed insert.
- **SSRF private-range coverage** in the http-request executor is thorough (loopback, RFC1918, CGNAT, link-local, IPv4-mapped IPv6, ULA) — the only gap is redirect-following (High finding above).
- **`logger.ts`** deep-redacts secret keys (nesting, arrays, Errors, circular refs); **`metrics.ts`** escapes label values and coarsens route labels.
- **Ship equipment** reads/writes are all `shipId`-scoped (no cross-ship IDOR); **worklist** global-KB routes are `adminRequired` and global/ship rows are separated via `isNull(shipId)`.
- **Project member** privilege-escalation guards (`assertAssignableRole`, `assertGrantWithinCaps`, last-owner guards) are present and correct at the route layer.
