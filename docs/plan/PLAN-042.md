# PLAN-042 — GitHub-style project role permissions (read / comment / write)

- Status: Approved — implementing (per-module model). L1 PROCEED 2026-05-30.
- Task: [FEAT-017](../task/FEAT-017.md)
- Campaign: l1-xlhyvzyz-roleperm-20260530223736
- Date: 2026-05-30
- Model: **PER-MODULE** capabilities (each module independently view/comment/manage),
  per L1 approval. (Supersedes the earlier project-wide `project.view` design.)

## Goal

Extend the per-project role/permission model so projects can be authorized like
a GitHub repository: a **Read-only** tier, a **Commenter** tier, a **Read-write**
tier, plus the existing **Owner/Admin**. User ask: "类似github的仓库授权，有只读，
读写，评论".

The project already has a real capability-gated role engine. The gap is that the
current capabilities are all *manage/write* level, with **no read-only and no
comment-only semantics**, and the two largest modules (issues, project files)
bypass capabilities entirely by gating on bare membership. This plan closes that
gap.

---

## 1. Current-state audit

### 1.1 Engine (works today)

- `PROJECT_CAPABILITIES` (7) in `apps/api/src/modules/project/schema.ts:13` —
  `project.manage`, `members.manage`, `roles.manage`, `categories.manage`,
  `procurement.view`, `procurement.manage`, `issue.manage`.
- Roles (`project_roles`) hold a JSON capability set; members inherit caps via
  their role (`getMemberCapabilities`, `project.service.ts:656`).
- Seed (`project.roles.ts:56`): `Project Owner` (isSystem, full set) + `Member`
  (empty caps, **not** isSystem, deletable).
- Gate helpers: `requireProject(c, shortId, capability?)`
  (`project.routes.ts:150`), `hasCapability` (`project.service.ts:668`).
- **Role deletion today** (`deleteRole`, `project.roles.ts:144`): refuses
  `isSystem` roles (`"system"`) **and** any role still held by a member
  (`"in_use"`). `projectMembers.roleId` FK is `onDelete: "restrict"`
  (`schema.ts:71`), so a held role cannot be deleted at the DB level either —
  members of a role are never auto-migrated; the admin must manually reassign
  every member first. `isSystem` is the **only** discriminator on a role; there
  is no way to tell two system roles apart structurally.

### 1.2 Effective access of a `Member` (empty caps) — the key finding

| Operation | Route | Gate today | Member (empty caps) |
|---|---|---|---|
| Project detail view | GET `/projects/:id` | membership only (`requireProject`, no cap) | **ALLOW** |
| Project update/delete/cover | PATCH/DELETE `/projects/:id` | `project.manage` | DENY |
| Members list | GET `/projects/:id/members` | membership only | **ALLOW** |
| Roles list | GET `/projects/:id/roles` | membership only | **ALLOW** |
| Categories list | GET `…/procurement-categories` | membership only | **ALLOW** |
| **Issue list / detail** | GET `…/issues[/:id]` | `requireProjectMember` = **membership only** | **ALLOW (read)** |
| **Issue create** | POST `…/issues` | membership only | **ALLOW (can create!)** |
| Issue edit / delete / pin | PATCH/DELETE/pin | `access.canEdit = isCreator \|\| issue.manage`; assignee → status only | own-created + assigned-status only |
| Issue attachment upload | POST `…/attachments` | `canEdit \|\| isAssignee` | own/assigned only |
| **Issue comment read** | GET `…/comments` | `canRead = isMember` | **ALLOW** |
| **Issue comment post** | POST `…/comments` | `canPost = canRead = isMember` | **ALLOW (can comment!)** |
| Issue comment delete | DELETE | author or admin | own only |
| **Procurement view (list/detail)** | GET `…/procurements` | membership **+ `procurement.view`** | **DENY (404)** |
| Procurement create/update/status/pin | mutations | `procurement.manage` | DENY |
| **Procurement comment read/post** | comments | membership + `procurement.view` | **DENY** |
| **Project files list / download** | GET `/drive/entries?ownerType=project` | membership only (`resolveListOwner`, `drive.routes.ts:600`) | **ALLOW (read)** |
| **Project files create / upload** | POST `/drive/folders`,`/drive/files/upload`,`/drive/entries/text-file` | membership only (`resolveCreateOwner`/`resolveUploadOwner`) | **ALLOW (write!)** |
| Project file update/trash/delete | PATCH/DELETE `/drive/entries/:id` | drive policy (`driveAccess`, creator/owner-scoped) | per-entry |

**Conclusion.** The empty-caps `Member` is *not* a clean role. It is effectively
"issue read + create + comment, project-file read + write, **no** procurement
visibility, no admin". Issues and project files honor only membership; procurement
is the only module that honors a `*.view` capability. To deliver clean GitHub-style
tiers we must (a) introduce *view* + *comment* capabilities, and (b) make the
issue / comment / drive routes honor them.

---

## 2. Capability model — PER MODULE (approved)

Each functional module is independently authorizable at view / comment / manage
level, so a custom role can mix freely (e.g. issue read-write **+** procurement
read-only **+** no files). The `module.action` naming already drives the Roles-UI
grouping (`CAPABILITY_GROUPS`, `-project-settings-roles.tsx:37`), so per-module
caps slot into their module group automatically.

### 2.1 Capability set (12)

Module caps:
- **Issue:** `issue.view` (read list/detail + read comments), `issue.comment`
  (post comments), `issue.manage` (create/edit/delete/pin/attach).
- **Procurement:** `procurement.view`, `procurement.comment`,
  `procurement.manage`.
- **Files (project drive):** `files.view` (list/download project-owned drive
  entries), `files.manage` (create/upload/edit/trash/delete project-owned drive
  entries).
  - **No `files.comment`** — verified: comments mount only on `items`-backed
    subjects (issue / procurement / document via `mountItemCommentRoutes`); drive
    entries (`drive_entries`) have no comment surface. Omitted per L1's
    conditional.

Project-level admin caps (KEEP, unchanged):
- `project.manage`, `members.manage`, `roles.manage`, `categories.manage`.

Changes vs today:
- **ADD:** `issue.view`, `issue.comment`, `procurement.comment`, `files.view`,
  `files.manage`.
- **KEEP:** `procurement.view`, `procurement.manage`, `issue.manage`,
  `categories.manage`, `members.manage`, `roles.manage`, `project.manage`.
- **No `project.view`** — the earlier project-wide read floor is replaced by the
  per-module `*.view` caps; nothing to migrate (it never shipped).

Full set (12): `issue.view`, `issue.comment`, `issue.manage`,
`procurement.view`, `procurement.comment`, `procurement.manage`,
`files.view`, `files.manage`, `categories.manage`, `members.manage`,
`roles.manage`, `project.manage`.

---

## 3. Roles: two implicit system roles + editable presets

### 3.1 Two IMPLICIT system roles (mandatory, undeletable)

Every project always has exactly two `isSystem` roles — the two ends of the
spectrum — neither of which can be deleted or have its capabilities edited:

| Implicit role | Capabilities | Purpose |
|---|---|---|
| **Owner** (`kind='owner'`) | all 12 | Full control; the project creator holds it. (Today's `Project Owner`.) |
| **Guest** (`kind='guest'`) | **none** (empty) | The no-permission **safety-net / fallback**. A member with Guest can do nothing beyond appearing as a member (no `*.view` ⇒ cannot even read any module). |

Both stay locked: `updateRole` already no-ops capability edits on `isSystem`
roles (`project.roles.ts:128`), so Guest stays empty and Owner stays full;
`deleteRole` refuses both (`"system"`).

**Discriminator.** `isSystem` alone cannot distinguish Owner from Guest. Add a
nullable `kind` column to `project_roles` — `'owner' | 'guest' | null` (null =
custom). Seeded system roles set it; custom roles leave it null. This is what
the deletion-fallback and the Owner-lockout guard key on (instead of fragile
capability-set sniffing).

### 3.2 Editable GitHub-style presets (seeded, non-system)

Seeded as ordinary editable/deletable roles so projects can assign them out of
the box and tune them:

Presets are cross-module convenience combos. **Custom roles may mix per-module
freely** (e.g. issue read-write + procurement read-only) — presets are just
common starting points.

| Preset | Capabilities | GitHub analogue |
|---|---|---|
| **Reader** (read-only) | `issue.view`, `procurement.view`, `files.view` | Read |
| **Commenter** | Reader + `issue.comment`, `procurement.comment` | Read + discussion |
| **Writer** (read-write) | Commenter + `issue.manage`, `procurement.manage`, `files.manage`, `categories.manage` | Write |

`members.manage`, `roles.manage`, `project.manage` stay Owner-only by default;
assignable to a custom "Maintainer"-style role via the Roles UI if desired (not
seeded).

> Alternative considered: ship Reader/Commenter/Writer as *quick-fill templates*
> in the create-role dialog rather than seeded rows, keeping the project's role
> list to just Owner+Guest. Rejected as the default because the user wants ready
> "授权" tiers; the template quick-fill is still added on top (see §6) for
> building custom roles.

### 3.3 Role deletion → auto-demote to Guest (NEW behavior)

Replace the current `"in_use"` rejection with auto-reassignment:

- Deleting an **implicit system role** (Owner or Guest, `kind` set / `isSystem`):
  refused → `"system"` (unchanged).
- Deleting a **custom role** (`kind=null`): inside one transaction,
  1. `UPDATE project_members SET role_id = <this project's Guest roleId>
     WHERE role_id = <deleted roleId>` — every holder is demoted to Guest (no
     permissions), never left dangling or errored.
  2. `DELETE` the role.
  Result `"deleted"`. The `"in_use"` branch is removed entirely.
- The `onDelete: "restrict"` FK stays as a safety net: the in-transaction
  reassignment runs *before* the delete, so no holder references the row at
  delete time and the FK never trips.
- Requires a `resolveGuestRole(db, projectId)` helper (select where
  `projectId` and `kind='guest'`). Guest is guaranteed to exist (seeded per
  project; backfilled by migration — see §5), so the fallback target is always
  present.

Members demoted to Guest immediately lose all access (no `*.view`); they
remain on the member roster and an Owner can reassign them a real role. This is
the intended "suspended / no-permission" state.

---

## 4. Gate points to add / change (backend)

Non-members are blocked entirely everywhere (fail-closed 404), unchanged.

1. **Issue read** — `requireProjectMember` (`issue.routes.ts:90`) must also
   require `issue.view`; non-members and members without `issue.view` →
   fail-closed 404. Applies to list (`:135`) + detail (`loadProjectIssue`).
2. **Issue create/edit/delete/pin** — POST `…/issues` (`:156`) requires
   `issue.manage` (today: membership only). Edit/delete/pin keep the
   `access.canEdit` path (`resolveProjectIssueAccess`, `issue.service.ts:488`),
   which becomes `isMember && (isCreator || issue.manage)` — but a non-writer can
   no longer create, so the creator path only benefits writers; assignee
   status-only edit unchanged.
3. **Issue comments** — issue `permissions()` block (`issue.routes.ts:428`):
   `canRead = issue.view`; **`canPost = issue.comment`** (decouple from read).
4. **Procurement** — `requireProcurementAccess` (`procurement.routes.ts:99`):
   read keeps `procurement.view` (already gated); mutations keep
   `procurement.manage`. Comment `permissions()` (`procurement.routes.ts:239`):
   `canRead = procurement.view`, **`canPost = procurement.comment`**.
5. **Project files (drive)** — `resolveListOwner` project branch
   (`drive.routes.ts:600`): require `files.view`. `resolveCreateOwner` (`:637`)
   and `resolveUploadOwner` (`:680`) project branches: require `files.manage`.
   Per-entry PATCH/DELETE for project-owned entries must also require
   `files.manage` (check `driveAccess`/`drive.permission.ts` project path; add
   the cap check there). **Scope strictly to `ownerType==="project"`** — personal
   and team-directory paths must not change.
6. **Project detail / members / roles / categories list** — stay membership-only
   (no single project-wide view cap exists anymore). A member with some `*.view`
   but not others sees the project shell and only the modules they can view.

7. **Role lifecycle** (`project.roles.ts`) — `seedDefaultRoles` seeds the two
   implicit system roles (Owner `kind=owner`, Guest `kind=guest`) + Reader/
   Commenter/Writer presets; `deleteRole` drops the `"in_use"` branch and instead
   reassigns holders to the project's Guest role before deleting a custom role
   (see §3.3); add `resolveGuestRole(db, projectId)`. `composeRole` exposes
   `kind` so the UI can label Owner/Guest. `DELETE /projects/:id/roles/:roleId`
   (`project.routes.ts:396`) no longer returns the "role in use" validation
   error.

All denials stay fail-closed 404 (mirroring existing convention) except
action-level denials on a readable subject (locked post, non-author delete),
which stay 403.

---

## 5. Migration mapping (dev-stage, breaking allowed)

- **Schema:** add nullable `kind` column to `project_roles`
  (`'owner' | 'guest' | null`). Change the model in `schema.ts`, then let
  Drizzle Kit emit the migration (never hand-author).
- **No capability rename:** the per-module model KEEPS `procurement.view` and
  introduces new caps (`issue.view`, `issue.comment`, `procurement.comment`,
  `files.view`, `files.manage`). `project.view` never shipped, so there is
  nothing to rename/migrate for it.
- **'Member' → 'Reader' mapping (with a flag — see note).** Convert each
  project's existing empty-caps `Member` role into the **Reader** preset: add the
  three `*.view` caps, rename to "Reader", keep it editable (`kind=null`).
  Existing members thereby **keep read access**.
  > ⚠️ L1 contradiction to confirm: the PROCEED message listed "Member→Guest
  > migration", but the two preceding L1 messages explicitly recommended
  > Member→**Reader** and stated "Guest reserved purely as the delete-fallback /
  > never auto-assigned except by deletion". Mapping Member→Guest would violate
  > that stated Guest invariant and silently strip existing members of all
  > access. This plan implements **Member→Reader** (internally consistent;
  > preserves access) and flags it for L1. On a freshly reseeded dev DB this is
  > moot anyway (creator=Owner; seeded members get explicit roles), so it is a
  > one-line safety-net either way — cheap to flip if L1 truly meant Guest.
- **Seed the implicit Guest SEPARATELY (not a renamed Member).** Guest is a new
  implicit-system role (`isSystem=1`, `kind='guest'`, empty caps), sitting
  **below Reader** (Reader has `*.view` and can view; Guest has nothing and
  cannot even view). Reserved purely as the delete-fallback / no-permission
  state; never auto-assigned except by the role-deletion flow (§3.3).
  - Backfill: insert one Guest row for every existing project so the
    deletion-fallback target always exists.
  - Mark the existing `Project Owner` row `kind='owner'` and grant it the full
    12-cap set.
- **Seed change:** `seedDefaultRoles` (`project.roles.ts:56`) seeds the two
  implicit system roles **Owner(kind=owner, all 12) + Guest(kind=guest, empty)**
  plus the three editable presets **Reader + Commenter + Writer**. Creator →
  Owner.
- **Existing custom roles:** keep their caps as-is; no rename needed (all current
  cap names survive in the per-module set).
- DB is migrate-on-boot in dev (restart tmux `bithk-dd24e5` to apply). Because
  the dev dataset is reseeded from the static seed (CHORE-003), the cleanest path
  is: update schema + seed + reseed; the Member→Reader + Guest-backfill data
  migration is the safety net for any live DB.

---

## 6. Frontend changes

- `apps/web/src/shared/lib/api/projects.ts:32` — mirror the 12-cap
  `PROJECT_CAPABILITIES` (add `issue.view`, `issue.comment`,
  `procurement.comment`, `files.view`, `files.manage`).
- `…/projects/-use-project-role.ts` — add per-module derived flags:
  `canViewIssues`/`canCommentIssues`/`canManageIssues`,
  `canViewProcurement`/`canCommentProcurement`/`canManageProcurement`,
  `canViewFiles`/`canManageFiles`. Update `computeCapabilities` + its test
  (`-use-project-role.test.ts`).
- Gate affordances per module:
  - Issue tab `-project-issues-tab.tsx` — gate the tab/list visibility on
    `canViewIssues`; hide "create issue" + edit unless `canManageIssues`.
  - Procurement tab `-project-procurement-tab.tsx` — visibility on
    `canViewProcurement`; mutations on `canManageProcurement` (already wired).
  - Comment section (issue/procurement detail + full views) — hide the composer
    unless the matching `*.comment` flag (issue vs procurement).
  - File browser surfaces (`-drive-file-list-toolbar.tsx`, `-file-browser.tsx`,
    project files tab) — gate project-scope visibility on `canViewFiles`; hide
    upload/new-folder/rename/delete unless `canManageFiles`.
- `…/projects/-project-settings-roles.tsx` — capability groups auto-derive, so
  new caps appear automatically. Changes:
  - Render both implicit roles (Owner + Guest) as read-only/locked with a
    "System" badge; hide edit/delete for `isSystem` (today only Owner is
    rendered specially — `role.isSystem ? t("roles.owner")` at L91). Add a Guest
    label + an explanatory line ("members of a deleted role fall back here").
  - The delete-confirm copy changes: deleting a custom role now **reassigns its
    members to Guest** rather than being blocked when in use. Update
    `roles.delete.confirm` wording to state the demotion. The old "role in use"
    error path is gone.
  - Add a **preset quick-fill** (Reader / Commenter / Writer buttons that set the
    checkbox set) in `RoleDialog` for building custom roles.
  - `ProjectRoleView` gains `kind` (`'owner'|'guest'|null`); mirror in
    `projects.ts`.
- i18n `locales/{en,zh}/projects.json` — add `capability.issue.view`,
  `capability.issue.comment`, `capability.procurement.comment`,
  `capability.files.view`, `capability.files.manage`, and
  `capabilityGroup.files`; add `roles.guest` label + the deleted-role-fallback
  explanatory string. (`capabilityGroup.issue` / `.procurement` already exist.)

---

## 7. Proposed implementation DAG + risks

### DAG

```
B1  schema: 12 per-module caps + `kind` column + seed (Owner+Guest implicit,
        Reader/Commenter/Writer presets) + deleteRole→demote-to-Guest +
        resolveGuestRole + Member→Reader & Guest-backfill migration +
        parseCapabilities/sanitize + role tests
        │
        ▼   (B2 ‖ B3 ‖ B4, parallel after B1's cap contract lands)
B2  issue gates: read=issue.view, create/edit/delete=issue.manage,
        comment post=issue.comment + tests
B3  procurement gates: comment post=procurement.comment (view/manage already
        gated) + tests
B4  drive project-scope gates: read=files.view, write=files.manage + tests
        │
        ▼
F1  frontend: 12-cap mirror + per-module role flags + UI gating + Owner/Guest
        locked rendering + delete-demotes-to-Guest copy + preset quick-fill +
        i18n + tests   (depends on B1 cap + kind contract)
```

Each L3 runs in its OWN worktree (L1 rule); `bun run check` green before merge;
verify on MAIN after merge before reporting; report at each merge milestone.
A separate CHORE may follow to regenerate API docs / reseed (mirrors
CHORE-002/003).

### Risks

- **Behavioral break:** issue read now needs `issue.view` and create needs
  `issue.manage` (today both membership-only); files read/write now gated. Many
  backend tests assume "any member can read/create/comment". Expect broad test
  updates (issue.routes.test, comment.routes.test, procurement.routes.test,
  drive permission tests). Acceptable per user (dev-stage, breaking OK).
- **Shared drive module:** project-scope gating lives in code paths shared with
  personal/team drives — changes must be branch-scoped to `ownerType==="project"`
  or risk regressing unrelated drive access.
- **Member→Guest vs Reader contradiction** (see §5 flag): implemented as Reader;
  awaiting L1 confirmation. One-line flip if wrong.
- **Naming/grouping:** all 12 caps keep `module.action` so the Roles-UI groups
  (`CAPABILITY_GROUPS`) render each module's view/comment/manage together.
- **Partial-view projects:** a member may view some modules and not others; the
  project shell + tabs must degrade gracefully (hide non-viewable tabs).

---

## Success criteria

1. Per-module gates hold: `issue.view`/`issue.comment`/`issue.manage`,
   `procurement.view`/`procurement.comment`/`procurement.manage`,
   `files.view`/`files.manage` each independently grant/deny their operation;
   non-members blocked entirely. (route tests)
2. Custom role mixing works: e.g. a role with `issue.view`+`issue.manage`+
   `procurement.view` can write issues + read procurement, but cannot write
   procurement or see files. (route tests)
3. Preset Reader = all `*.view`; Commenter = +`*.comment`; Writer =
   +`*.manage`+`categories.manage`. (route tests)
4. Owner (all 12, isSystem, `kind=owner`) + app-admin bypass unchanged.
5. **Guest** exists per project (isSystem, `kind=guest`, empty, undeletable); a
   Guest member can do nothing (no `*.view`). (route tests)
6. **Delete-fallback:** deleting a custom role reassigns every holder to Guest in
   one transaction and succeeds (no "in use" error); no dangling role.
   (route + service tests)
7. Existing 'Member' migrated to **Reader** (gains the `*.view` caps) so members
   keep read access; Guest is a separate fallback, never auto-assigned except by
   deletion. (migration test) — *pending L1 confirm of Reader-vs-Guest (§5).*
8. Roles UI shows the 12 caps grouped by module; Owner + Guest render locked;
   presets seed on new projects; delete copy states the demotion. (web tests)
9. `bun run check` green on each L3 branch and on MAIN after each merge.
