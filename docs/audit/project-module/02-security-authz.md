# Lane 02 — Security / AuthZ Audit (Project Module)

P0 x0 · P1 x1 · P2 x3 · P3 x6

Scope: project role/capability model, route-level authorization across
`project.routes.ts` + roles/categories/cover endpoints, ownership & guest
scoping, IDOR (cross-project action), input validation at boundaries, data
exposure, missing authz on mutations, `deleteRole` demote-to-Guest correctness.
Issue/procurement/file/drive route guards reviewed insofar as project detail
tabs consume them. Frontend capability gating reviewed (treated as cosmetic;
backend is authoritative).

Backend reviewed (repo-relative): `apps/api/src/modules/project/{project.routes.ts,project.service.ts,project.roles.ts,project.categories.ts,project.global-categories.ts,project.cover.permission.ts,schema.ts}`, `apps/api/src/modules/tag/{tag.routes.ts,tag.service.ts,tag.registry.ts}`, `apps/api/src/modules/issue/issue.routes.ts`, `apps/api/src/modules/procurement/procurement.routes.ts`, `apps/api/src/modules/drive/{drive.routes.ts,drive.permission.ts}`, `apps/api/src/modules/item/comment.routes.ts`, `apps/api/src/shared/middleware/auth.ts`.
Frontend reviewed: `apps/web/src/app/routes/_app/projects/{-use-project-role.ts,-project-settings-members.tsx,-member-helpers.ts}`.

---

## Findings (sorted by severity)

### F1 — `members.manage` can self-assign the Owner system role → full project takeover (privilege escalation)
- **Severity:** P1 high
- **Location:** `apps/api/src/modules/project/project.routes.ts:340-348` (POST members), `:350-360` (PATCH member); role validation `apps/api/src/modules/project/project.roles.ts:137-141` (`resolveRole`).
- **Description:** Adding or editing a member only validates that `roleId` belongs to the project (`resolveRole`). There is **no exclusion of the `kind='owner'` / `isSystem=1` role** from assignment. Any member whose role grants `members.manage` can therefore assign the Owner role (all 12 capabilities) to themselves or to any user/virtual member. The web UI confirms the surface is reachable: `RoleSelect` (`apps/web/src/app/routes/_app/projects/-project-settings-members.tsx:412-434`, used at `:290` and `:361`) lists every role including the system Owner role for assignment.
- **Impact:** `members.manage` is intended to delegate member administration, but it is effectively equivalent to full ownership: a holder can grant themselves `project.manage` (edit/archive/**delete** the project), `roles.manage`, every issue/procurement/files capability — a complete privilege escalation and project takeover. Among the seeded presets only Owner holds `members.manage`, but an Owner who creates a custom "Member admin" role with `members.manage` (a natural delegation) unknowingly hands out full ownership.
- **Recommended fix:** In `addMember`/`updateMember` (or the route handlers) reject assignment of any role with `kind='owner'` (and arguably `kind='guest'`, which should only be reached via the delete-fallback path), returning a 403/validation error. Reserve owner-role assignment for app admins, or model ownership transfer as an explicit, separately-gated operation. Do not let `members.manage` confer the ability to grant the owner role.

---

### F2 — `roles.manage` allows unbounded capability escalation on custom roles (self-escalation to owner-equivalent)
- **Severity:** P2 medium
- **Location:** `apps/api/src/modules/project/project.roles.ts:158-200` (`createRole`/`updateRole`), routes `apps/api/src/modules/project/project.routes.ts:378-394`.
- **Description:** `updateRole` only locks `isSystem=1` roles (`project.roles.ts:189-190`); for any custom role the caller may set `capabilities` to an arbitrary subset of `PROJECT_CAPABILITIES` (sanitized only against the known-cap set, `project.roles.ts:46-48`). A member who holds `roles.manage` via a **custom** role can edit that very role — or create a new one and (via F1) assign it — to grant `project.manage`, `members.manage`, `roles.manage`, etc.
- **Impact:** `roles.manage` is effectively owner-equivalent: a holder can grant any capability to their own role with no ceiling, escalating to project deletion / full control. There is no "cannot grant a capability you do not already hold" constraint.
- **Recommended fix:** Constrain capability grants so a non-owner editor cannot grant capabilities they do not themselves hold (no privilege amplification), or restrict the most dangerous caps (`project.manage`, `members.manage`, `roles.manage`) to the Owner role / app admins only. Document the trust model explicitly in `docs/decisions/` if `roles.manage` is intended to be owner-equivalent.

---

### F3 — No safeguard against demoting/removing the last Owner (ownerless project lockout)
- **Severity:** P2 medium
- **Location:** `apps/api/src/modules/project/project.service.ts:604-636` (`updateMember`/`removeMember`); routes `apps/api/src/modules/project/project.routes.ts:350-369`.
- **Description:** `removeMember` deletes any member by id, and `updateMember` can change any member's `roleId` (including the sole Owner's) to Guest or a low-capability role. Nothing enforces a "≥1 owner must remain" invariant. A `members.manage` holder (or the Owner themselves by accident) can remove or demote the last Owner.
- **Impact:** The project can be left with zero members holding `project.manage`/`members.manage`/`roles.manage`. Only an app admin (who bypasses membership) could then recover it — ordinary project administration becomes impossible. Availability / self-lockout.
- **Recommended fix:** Before removing a member or changing a role away from owner, count remaining members holding the `kind='owner'` role (or `project.manage`); refuse the operation when it would drop the count to zero, returning a clear validation error. Mirror the protection used for system roles.

---

### F4 — Member create/update accept arbitrary `userId` with no existence/duplication check → 500 instead of clean 4xx
- **Severity:** P3 low
- **Location:** `apps/api/src/modules/project/project.routes.ts:79-97` (schemas), `apps/api/src/modules/project/project.service.ts:577-591` (`addMember`), `:604-629` (`updateMember`); schema FK + unique index `apps/api/src/modules/project/schema.ts:83,94`.
- **Description:** `addMemberSchema`/`updateMemberSchema` validate only that `userId` is a non-empty string. The service inserts it directly; correctness relies on the `user_id → users.id` FK and the `(projectId, userId)` unique index to reject bad input. A non-existent user id (FK violation) or a duplicate real-user membership (unique-index violation) surfaces as an uncaught DB error → 500 `INTERNAL_ERROR` rather than a 400/404/409 with a useful message. The `userId` is also unvalidated on the virtual→real promotion path (`updateMember`, `:624-625`).
- **Impact:** Boundary-validation gap: callers cannot distinguish input errors from server faults; raw DB errors may leak in error responses/logs. Not a direct authz bypass (the route is already `members.manage`-gated).
- **Recommended fix:** Validate that `userId` references an existing user and is not already a member of the project before insert/update; return `ValidationError`/`NotFoundError`/409 accordingly (the same pattern already used for `resolveRole` at `project.routes.ts:344-345,354-355`).

---

### F5 — Global tag vocabulary + cross-project usage counts exposed to any authenticated user
- **Severity:** P3 low
- **Location:** `apps/api/src/modules/tag/tag.routes.ts:22-26` (`GET /tags`), `apps/api/src/modules/tag/tag.service.ts:58-71` (`listTagsWithUsage`).
- **Description:** `GET /tags?type=project` is gated by `authRequired` only — any logged-in user receives the full project-tag vocabulary plus a `usageCount` aggregated across **all** projects, regardless of which projects they belong to. The same applies to embedded tag views (`loadResourceTagsByResource`, `tag.service.ts:227-252`) which also carry the global count. Project tag names can encode sensitive context (client names, codenames).
- **Impact:** Information disclosure: a low-privilege user can enumerate sensitive project tag names and infer project counts/activity for projects they cannot otherwise see. Tags are a deliberately shared vocabulary, so this may be by design, but it is worth an explicit decision.
- **Recommended fix:** If tag names are not meant to be globally visible, scope the `/tags` listing (and embedded usage counts) to tags the caller can reach, or restrict the management-oriented count to admins. Otherwise record the global-vocabulary exposure as an accepted risk in `docs/decisions/`.

---

### F6 — `tags_refs` join has no type/domain scoping; isolation relies on id-space uniqueness
- **Severity:** P3 low
- **Location:** `apps/api/src/modules/tag/tag.service.ts:192-252` (`listResourceTagViews`, `loadResourceTagsByResource`), schema note `apps/api/src/modules/project/schema.ts:121-122`.
- **Description:** The shared `tags_refs` table keys assignments by `resource_id` with no FK and no domain/type column. `loadResourceTagsByResource` ignores its `binding` argument entirely and queries purely by `resourceId` (joining tags of any type). Cross-domain isolation depends on resource ids never colliding across domains (project ULIDs vs issue/procurement nanoids, etc.).
- **Impact:** Defense-in-depth gap. A collision (or a future domain reusing an id format) would let one resource's tags surface under another domain. Very low likelihood given current id schemes; no concrete exploit found.
- **Recommended fix:** Add a domain/type discriminator to `tags_refs` (and filter on it in the resource-assignment helpers), or assert that all resource-id spaces are guaranteed globally disjoint and document that assumption.

---

### F7 — Comment routes do not validate the subject belongs to the path `:projectId` (inconsistent with detail routes)
- **Severity:** P3 low
- **Location:** `apps/api/src/modules/item/comment.routes.ts:99-115` (`load`), wiring `apps/api/src/modules/issue/issue.routes.ts:422-453` and `apps/api/src/modules/procurement/procurement.routes.ts:227-266`.
- **Description:** The mounted comment routes resolve the issue/procurement by its own short id and compute permissions from the resource's **real** project — the `:projectId` path segment is structural only and is never checked for consistency. By contrast the detail GET routes explicitly assert `ownerProject === projectId` and 404 on mismatch (`issue.routes.ts:123-125`; `procurement.routes.ts:130-131`).
- **Impact:** No privilege bypass — access is correctly derived from the resource's actual project membership, so a user lacking access to the real project is still denied. The only effect is that a mismatched-but-authorized path (e.g. commenting on issue X via `/projects/<other-project>/issues/X/...`) succeeds, which is cosmetically inconsistent and could confuse audit-trail `detail.projectId` values.
- **Recommended fix:** For parity and clearer audit data, validate that the resolved subject's project matches the path `:projectId` in the comment `resolve` step and 404 on mismatch, mirroring the detail routes.

---

### F8 — No rate limiting on project-module mutation endpoints
- **Severity:** P3 low-nit
- **Location:** `apps/api/src/modules/project/project.routes.ts:169-171` (router setup; only `authRequired` applied).
- **Description:** Project create/update/delete, member/role/category mutations, and cover uploads carry no per-actor rate limiting. The org security policy calls for rate limiting on endpoints; none is present here (or via a shared middleware visible to this module).
- **Impact:** Abuse/DoS surface (e.g. rapid role churn, repeated multipart cover uploads bounded only by `MAX_UPLOAD_BYTES`). Low for an internal authenticated tool.
- **Recommended fix:** Apply a shared rate-limiter middleware to mutation routes (or app-wide `/api/*`), keyed by authenticated user id, if this app is exposed beyond a trusted network.

---

## Areas checked and found clean

- **Cross-project IDOR on tab content (issue / procurement / files):** Solid. Each module re-resolves the project from its short id and re-checks membership + the relevant capability on the resource's **real** project, then asserts the resource belongs to that project, all fail-closed to 404 — `issue.routes.ts:91-130`, `procurement.routes.ts:99-133`, drive `drive.permission.ts:85-98` + route gates `drive.routes.ts:600-703`. A member of project A cannot act on project B resources by swapping the path id.
- **Fail-closed existence policy:** `requireProject` (`project.routes.ts:150-167`) and the issue/procurement guards surface missing-project, non-member, and missing-capability uniformly as 404, never leaking membership/existence. Capability-specific denials for an actor who can already see the resource correctly return 403 (`drive.permission.ts:137-146`).
- **SQL injection:** All queries use Drizzle parameter binding; the only raw `LIKE` patterns escape wildcards via `escapeLike` with an explicit `ESCAPE '\'` clause (`project.service.ts:46-51,356-362`). No string interpolation into SQL.
- **Capability integrity:** Capabilities are stored as JSON and always sanitized against `PROJECT_CAPABILITIES` on write (`project.roles.ts:46-48,165,197`) and on read (`parseCapabilities`, `:22-32`), dropping unknown values. Route gates check capabilities, not role names.
- **System role protection:** `updateRole` refuses capability edits to `isSystem=1` roles (`project.roles.ts:189-190`); `deleteRole` refuses system roles (`:211-212`).
- **`deleteRole` demote-to-Guest correctness:** Correct. It refuses system roles, then in a single transaction reassigns every holder to the project's seeded Guest role before deleting (required because `project_members.role_id` is `ON DELETE restrict`) — `project.roles.ts:209-227`. Guest is guaranteed by seeding (`project.service.ts:253` via `seedDefaultRoles`) and boot-time backfill (`project.roles.ts:290-305`). Minor defense-in-depth nit: the reassignment `where(eq(projectMembers.roleId, roleId))` (`:222`) is not additionally scoped by `projectId`; this is safe only because role ids are globally unique nanoids validated to belong to the project — adding an explicit `projectId` predicate would harden it.
- **Cover-image authorization:** `projectCoverPermissionHook` (`project.cover.permission.ts:14-26`) restricts read to project members and delete to `project.manage`, with admin bypass; inherited ship-cover URLs are authorized through the existing `ship_cover` hook (`project.service.ts:153-192`). Upload routes are `project.manage`-gated and validate mimetype (`project.routes.ts:303-330`).
- **Admin-only global resources:** Global procurement categories, global default cover, and tag create/rename/delete are all `adminRequired` (`project.routes.ts:175-235`, `tag.routes.ts:29-53`).
- **Comment authorization:** `mountItemCommentRoutes` enforces `canRead` (fail-closed 404), `canPost` (403), per-author/admin `canDelete`, and `includeInternal` correctly; comment-attachment upload is restricted to the comment author even for admins (`comment.routes.ts:99-271`). Issue/procurement supply correct capability-derived permissions (`issue.comment` / `procurement.comment`).
- **Virtual members cannot authenticate as actors:** capability resolution joins on `project_members.user_id` (`project.service.ts:653-662`); virtual members carry `null` userId and never resolve to capabilities, so they are assignment targets only.
- **Frontend gating is cosmetic only:** `computeCapabilities`/`useProjectCapabilities` (`-use-project-role.ts`) drive UI affordances, but every gated action is independently enforced server-side (verified above). No security decision relies on the client.

## Out-of-scope note (not authz, observed in passing)
`projects.version` is incremented on every update (`project.service.ts:409`) but never checked against a client-supplied version (no optimistic-concurrency guard), so concurrent edits can silently lost-update. Functional/robustness concern, not a security finding.
