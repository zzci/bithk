# PLAN-042 — GitHub-style project role permissions (read / comment / write)

- Status: Draft (analysis only — awaiting approval before implementation)
- Task: [FEAT-017](../task/FEAT-017.md)
- Campaign: l1-xlhyvzyz-roleperm-20260530223736
- Date: 2026-05-30

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

## 2. Proposed capability model

Two granularity options were evaluated:

- **Option A — project-wide `view` + `comment`, per-module `manage` (RECOMMENDED).**
  One read floor and one comment grant for the whole project; writing stays
  split per module (issues / procurement / files). This matches the ask
  ("like a GitHub repo") — GitHub authorizes the whole repo, not per-feature.
- **Option B — per-module view/comment** (`issue.view`, `issue.comment`,
  `procurement.view`, `files.view`, …). More granular, but ~8→14 capabilities,
  heavier UI, and not what "仓库授权" implies. Rejected as over-engineering for
  the stated need.

### 2.1 Recommended capability set (Option A)

Add:
- `project.view` — read floor: project overview, issue list/detail, procurement
  list/detail, project files list/download, read comments. Required of every
  active member.
- `comment.create` — post comments (and own-comment delete + comment
  attachments) on issues and procurement.
- `files.manage` — create/upload/edit/trash/delete **project-owned** drive files.

Keep: `issue.manage`, `procurement.manage`, `categories.manage`,
`members.manage`, `roles.manage`, `project.manage`.

Remove: `procurement.view` — folded into `project.view`.

> Naming note: capability names must keep the `module.action` shape because the
> Roles UI groups checkboxes by the prefix before `.` (`CAPABILITY_GROUPS`,
> `-project-settings-roles.tsx:37`). Hence `comment.create` (not bare `comment`)
> and `files.manage`. A bare `comment` would land in its own one-item group and
> is avoided.

Resulting set (9): `project.view`, `comment.create`, `issue.manage`,
`procurement.manage`, `files.manage`, `categories.manage`, `members.manage`,
`roles.manage`, `project.manage`.

---

## 3. Roles: two implicit system roles + editable presets

### 3.1 Two IMPLICIT system roles (mandatory, undeletable)

Every project always has exactly two `isSystem` roles — the two ends of the
spectrum — neither of which can be deleted or have its capabilities edited:

| Implicit role | Capabilities | Purpose |
|---|---|---|
| **Owner** (`kind='owner'`) | all 9 | Full control; the project creator holds it. (Today's `Project Owner`.) |
| **Guest** (`kind='guest'`) | **none** (empty) | The no-permission **safety-net / fallback**. A member with Guest can do nothing beyond appearing as a member (no `project.view` ⇒ cannot even read). |

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

| Preset | Capabilities | GitHub analogue |
|---|---|---|
| **Reader** (read-only) | `project.view` | Read |
| **Commenter** | `project.view`, `comment.create` | Read + discussion |
| **Writer** (read-write) | `project.view`, `comment.create`, `issue.manage`, `procurement.manage`, `files.manage`, `categories.manage` | Write |

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

Members demoted to Guest immediately lose all access (no `project.view`); they
remain on the member roster and an Owner can reassign them a real role. This is
the intended "suspended / no-permission" state.

---

## 4. Gate points to add / change (backend)

1. **Issue read floor** — `requireProjectMember` (`issue.routes.ts:90`) must also
   require `project.view`; non-members and view-less members → fail-closed 404.
2. **Issue create** — POST `…/issues` (`issue.routes.ts:156`) must require
   `issue.manage` (today: membership only). *Breaking:* current members lose
   implicit create.
3. **Issue edit fast-path** — `resolveProjectIssueAccess` (`issue.service.ts:488`)
   `canEdit = isMember && (isCreator || issue.manage)`. Under the new model a
   non-writer cannot create, so the `isCreator` path only ever benefits writers;
   keep as-is (assignee status-only edit unchanged).
4. **Issue comments** — issue `permissions()` block (`issue.routes.ts:428`):
   `canRead = project.view`; **`canPost = comment.create`** (decouple from read).
5. **Procurement** — `requireProcurementAccess` (`procurement.routes.ts:99`):
   replace `procurement.view` with `project.view`; mutations keep
   `procurement.manage`. Comment `permissions()` (`procurement.routes.ts:239`):
   `canRead = project.view`, `canPost = comment.create`.
6. **Project files (drive)** — `resolveListOwner` project branch
   (`drive.routes.ts:600`): require `project.view`. `resolveCreateOwner`
   (`:637`) and `resolveUploadOwner` (`:680`) project branches: require
   `files.manage`. Per-entry PATCH/DELETE for project-owned entries must also
   require `files.manage` (verify `driveAccess`/`drive.permission.ts` project
   path; add cap check there). **Scope strictly to `ownerType==="project"`** —
   personal and team-directory paths must not change.
7. **Project detail / members / roles / categories list** — currently
   membership-only. With `project.view` as the floor, optionally tighten these
   to `project.view` for consistency (a member without `project.view` is
   effectively suspended). Low priority; can stay membership-only.

8. **Role lifecycle** (`project.roles.ts`) — `seedDefaultRoles` seeds the two
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
- **Capability rename:** any stored role capability `procurement.view` →
  `project.view`. `parseCapabilities` already drops unknown strings, so a stale
  `procurement.view` would otherwise silently vanish — migrate it explicitly.
- **'Member' → 'Guest' (the key mapping).** The current empty-caps `Member`
  role *is* the no-permission state, so it becomes the implicit **Guest**:
  set `isSystem=1`, `kind='guest'`, keep capabilities empty (display name via
  i18n "Guest"). **Member is NOT the read-only role** — read-only is the new,
  separate, editable **Reader** preset (`project.view`). This keeps a clean
  split: Guest = no access fallback; Reader = read-only.
  - Backfill safety: for any project lacking a `kind='guest'` row (e.g. its
    Member was renamed/deleted), insert an empty-caps system Guest role so the
    deletion-fallback target always exists.
  - Mark the existing `Project Owner` row `kind='owner'`.
- **Seed change:** `seedDefaultRoles` (`project.roles.ts:56`) seeds the two
  implicit system roles **Owner(kind=owner) + Guest(kind=guest)** plus the three
  editable presets **Reader + Commenter + Writer**. Creator → Owner.
- **Existing custom roles:**
  - Roles with `procurement.view` → `project.view`.
  - Roles that had `issue.manage`/`procurement.manage` → add `project.view`
    (and `comment.create`) so writers retain read/comment.
- DB is migrate-on-boot in dev (restart tmux `bithk-dd24e5` to apply).
  Because the dev dataset is reseeded from the static seed (CHORE-003), the
  cleanest path is: update schema + seed + reseed; the cap-rename and
  Member→Guest data migration is the safety net for any live DB.

---

## 6. Frontend changes

- `apps/web/src/shared/lib/api/projects.ts:32` — mirror new
  `PROJECT_CAPABILITIES` (add `project.view`, `comment.create`, `files.manage`;
  remove `procurement.view`).
- `…/projects/-use-project-role.ts` — add derived flags `canView`,
  `canComment`, `canManageFiles`; keep `canManageProcurement`, `canManageIssues`
  (add `has("issue.manage")`). Update `computeCapabilities` + its test
  (`-use-project-role.test.ts`).
- Gate write affordances:
  - Issue tab `-project-issues-tab.tsx` — hide "create issue" unless
    `issue.manage`; hide edit controls accordingly.
  - Procurement tab `-project-procurement-tab.tsx` — already gates on
    `canManageProcurement`; switch the visibility gate from `procurement.view`
    to `canView`.
  - Comment section (issue/procurement detail + full views) — hide the comment
    composer unless `canComment`.
  - File browser surfaces (`-drive-file-list-toolbar.tsx`,
    `-file-browser.tsx`, project files tab) — hide upload/new-folder/rename/
    delete for project scope unless `canManageFiles`.
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
- i18n `locales/{en,zh}/projects.json` — add `capability.project.view`,
  `capability.comment.create`, `capability.files.manage`, and
  `capabilityGroup.comment`, `capabilityGroup.files`; remove
  `capability.procurement.view`.

---

## 7. Proposed implementation DAG + risks

### DAG

```
B1  schema caps + `kind` column + seed (Owner+Guest implicit, Reader/Commenter/
        Writer presets) + deleteRole→demote-to-Guest + resolveGuestRole +
        cap-rename & Member→Guest migration + parseCapabilities + role tests
        │
        ▼
B2  issue routes/service gates (read=project.view, create=issue.manage,
        comments post=comment.create) + tests
B3  procurement routes gates (view→project.view, post=comment.create) + tests
B4  drive project-scope gates (read=project.view, write=files.manage) + tests
   (B2/B3/B4 parallel after B1)
        │
        ▼
F1  frontend caps mirror + role flags + UI gating + Owner/Guest locked rendering
        + delete-demotes-to-Guest copy + preset quick-fill + i18n + tests
   (depends on B1 capability + kind contract; can start once B1 names are fixed)
```

A separate CHORE may follow to regenerate API docs / reseed (mirrors CHORE-002/003).

### Risks

- **Behavioral break:** issue create tightened from membership → `issue.manage`;
  many backend tests assume "any member can create/comment". Expect broad test
  updates (issue.routes.test, comment.routes.test, procurement.routes.test).
  Acceptable per user (dev-stage, breaking OK).
- **Shared drive module:** project-scope gating lives in code paths shared with
  personal/team drives — changes must be branch-scoped to `ownerType==="project"`
  or risk regressing unrelated drive access.
- **Capability rename** (`procurement.view`→`project.view`) is breaking for any
  stored custom role; handle via the data migration above.
- **Naming/grouping:** `comment.create` & `files.manage` chosen to satisfy the
  Roles-UI module grouping; a bare `comment` would group oddly.
- **Suspended-member edge:** if `project.view` is the floor and a member lacks
  it, they are effectively locked out while still appearing as a member — this is
  intended (Reader is the minimum useful role) but should be documented in the UI.

---

## Success criteria (for the implementation phase, post-approval)

1. Reader role: can view issues/procurement/files + read comments; cannot create
   issues, post comments, upload files, or mutate anything. (route tests)
2. Commenter role: Reader + can post comments; still cannot create issues or
   upload files. (route tests)
3. Writer role: can create/edit issues + procurement + upload/manage files +
   comment; cannot manage members/roles/project. (route tests)
4. Owner unchanged (full set, isSystem, `kind=owner`). App admin bypass unchanged.
5. **Guest** role exists per project (isSystem, `kind=guest`, empty caps,
   undeletable); a Guest member can do nothing (no `project.view`). (route tests)
6. **Delete-fallback:** deleting a custom role reassigns every holder to Guest in
   one transaction and succeeds (no "in use" error); no member is left dangling.
   (route + service tests)
7. 'Member' no longer exists as a distinct empty role — it is migrated to Guest;
   read-only is the separate Reader preset. (migration test)
8. Roles UI shows new capabilities grouped correctly; Owner + Guest render locked;
   presets seed on new projects; delete copy states the demotion. (web tests)
9. `bun run check` green.
