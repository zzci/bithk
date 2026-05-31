# Project Module Audit — Lane 07: Tests / Dead Code

P0 0 .. P1 0 .. P2 2 .. P3 8

Read-only audit (PMA investigate phase). Findings only — no fixes applied.

Scope audited:
- Backend: `apps/api/src/modules/project/*` (routes, service, roles, categories,
  global-categories, cover.permission, backup, index, schema) and
  `apps/api/src/modules/tag/*` (routes, service, registry, backup, index, schema).
- Frontend: `apps/web/src/app/routes/_app/projects/*` (list, detail tab shell, tab
  routes, panels, settings, hooks, helpers, tag-filter) and shared
  `priority-signal.tsx` / `status-colors.ts`.

## Overview

Test coverage for the project module is **good**, not deficient. The service layer
(`project.service.test.ts`), routes (`project.routes.test.ts`), role engine +
boot backfill (`project.roles.backfill.test.ts`), covers
(`project.cover.test.ts`, `project.default-cover.test.ts`), the cover permission
hook, and most frontend components/logic units all have dedicated tests. The tag
service is well covered (`tag.service.test.ts`). The findings below are gaps and
small cleanups, not systemic holes.

**Premise correction (important):** the lane brief flags
`project.backup.ts` and `tag.backup.ts` as "leftover backup files". They are
**not** leftovers. They are live `BackupContribution` definitions for the
data-export/restore feature — every module has one
(`contact.backup.ts`, `ship.backup.ts`, `issue.backup.ts`, …), and both are
registered at load time (`project/index.ts:7`, `tag/index.ts:4` via
`registerBackupContribution`). They MUST NOT be deleted; doing so would silently
drop those tables from backup/restore. They are reported below only for the
*test gap* on the project contribution (F2), not as dead code.

---

## Findings (sorted by severity)

### F1 (P2) — tag registry read-side is dead code; module comment is misleading
- **Location** `apps/api/src/modules/tag/tag.registry.ts:20` (`getTagBinding`),
  `:28` (`listRegisteredSourceTypes`), `:4-7` (module comment);
  callers `apps/api/src/routes/protected.ts:32-36`; consumer that bypasses it
  `apps/api/src/modules/tag/tag.routes.ts:13,23,49`.
- **Description** `getTagBinding` and `listRegisteredSourceTypes` are exported but
  have **zero references anywhere** in the codebase (verified by grep across
  `apps/api/src`, including tests). `registerTagSource` IS called five times in
  `protected.ts` (project/contact/document/issue/procurement), but it only writes
  to the private `sources` map — and nothing ever reads that map, because the two
  read accessors are unused. The `/tags` routes resolve the type from the static
  `TAG_TYPES` enum (`tag.routes.ts:13` `tagTypeSchema`), never via the registry.
  The module comment claims "the shared `/tags` routes learn which types exist"
  through this registry — that wiring does not exist, so the comment is
  misleading.
- **Impact** Whole registry read-path is dead weight; the five `registerTagSource`
  calls are no-ops kept alive only by the dead export. Future maintainers may
  assume `/tags` validation is registry-driven (it is not) and "fix" the wrong
  layer. Dev phase — no compat concern blocks removal.
- **Recommended fix** Either (a) delete `getTagBinding`,
  `listRegisteredSourceTypes`, the `sources` map, `registerTagSource`, and the
  five `protected.ts` calls, plus the `registerTagSource` re-export in
  `tag/index.ts`; or (b) if the registry is meant to gate `/tags` types, wire
  `tag.routes.ts` to derive its enum from `listRegisteredSourceTypes()` and add a
  test. Pick one; do not leave the half-built pattern. Update/remove the
  misleading comment to match.

### F2 (P2) — `projectBackupContribution` has no test (backup round-trip gap)
- **Location** `apps/api/src/modules/project/project.backup.ts:4`; registered at
  `apps/api/src/modules/project/index.ts:7`. Compare:
  `apps/api/src/modules/contact/contact.backup.test.ts:12,25` exercises
  `tagBackupContribution`, and `apps/api/src/modules/backup/restore.*.test.ts`
  exercise account/settings/file contributions.
- **Description** The project backup contribution declares table insert order
  (`projects → projectRoles → projectMembers → procurementCategories`) and deps
  (`users`, `ships`, `tags`) that exist precisely to satisfy FK ordering on
  restore. No test imports `projectBackupContribution` or asserts a
  project-tables export/restore round-trip. A wrong table order or missing dep
  would only surface at runtime restore, not in CI.
- **Impact** The FK-ordering invariant — the entire reason this file's table list
  is non-trivial — is unverified. A regression (e.g. dropping `projectRoles`
  before `projectMembers`, or removing the `ships` dep) passes all current tests.
- **Recommended fix** Add a `project.backup.test.ts` mirroring
  `contact.backup.test.ts`: register the project + dependency contributions, seed
  a project with roles/members/categories, export, wipe, restore, and assert the
  rows reappear intact (and that restore order does not violate FKs).

### F3 (P3) — project detail tab-nav shell (`$projectId.lazy.tsx`) untested
- **Location** `apps/web/src/app/routes/_app/projects/$projectId.lazy.tsx:37-190`.
- **Description** `ProjectDetailLayout` holds non-trivial composition logic: tab
  gating by capabilities (`caps.canViewIssues/Procurement/Files`, lines 153-169),
  per-tab count badges (`issuesCount`/`procurementCount`, lines 54-57,97),
  settings deep-link open/close that strips the `?settings` param
  (`handleSettingsOpenChange`, lines 71-79), and the loading/not-found branches
  (81-95). No test renders this component. Its underlying units **are** tested
  (`-project-tabs.test.ts` for `activeProjectTab`, `-use-project-role.test.ts` for
  caps, `$projectId.search.test.ts` for `validateProjectDetailSearch`), but the
  composition that wires them together is not.
- **Impact** Regressions in tab visibility gating or the settings deep-link
  cleanup would not be caught.
- **Recommended fix** Add a component test (`renderWithProviders`) asserting:
  hidden tabs for a reader-capability project, count badges render when totals
  resolve, and the not-found branch on query error.

### F4 (P3) — per-issue React-Query hooks (`-project-issue-hooks.ts`) untested
- **Location**
  `apps/web/src/app/routes/_app/projects/-project-issue-hooks.ts:27-75`.
- **Description** `useProjectIssue`, `useUpdateProjectIssue`, and
  `useDeleteProjectIssue` carry cache-coherence logic: `setQueryData` on update
  (line 56) and multi-key `invalidateQueries`/`removeQueries` on delete
  (lines 70-72). No test file exists for this module. The cache-key shape
  (`issueKey`, line 23) and the invalidation fan-out are exactly the kind of
  logic that silently breaks.
- **Impact** A wrong query key or missing invalidation (stale issue list after
  edit/delete) would ship undetected.
- **Recommended fix** Add hook tests with a mocked `http` and a real
  `QueryClient`, asserting the cache is updated on success and the expected keys
  are invalidated/removed on delete.

### F5 (P3) — `tag.registry.ts` has no test
- **Location** `apps/api/src/modules/tag/tag.registry.ts` (no
  `tag.registry.test.ts` present).
- **Description** The registry module is entirely untested. This compounds F1: if
  option (b) there is chosen (wire `/tags` to the registry), there is no guard;
  if option (a), this finding dissolves with the deletion.
- **Impact** Low while the read-side stays dead (F1); rises if the registry is
  ever made load-bearing.
- **Recommended fix** Resolve F1 first. If the registry survives, add a small test
  for register/resolve/throw-on-missing behavior.

### F6 (P3) — `assertValidTagName` over-exported
- **Location** `apps/api/src/modules/tag/tag.service.ts:30`.
- **Description** `assertValidTagName` is `export`ed but is used only internally
  (`createTag` line 82, `renameTag` line 103) and has no external consumer and no
  direct test (unlike its siblings `normalizeTagName` and `resolveTagIdByIdOrName`,
  which `tag.service.test.ts:58,201` test directly, justifying their export).
- **Impact** Minor — widens the module's public surface with no consumer; covered
  only indirectly via `createTag`/`renameTag` tests.
- **Recommended fix** Drop the `export` (make it module-private), or add a direct
  unit test if it is intended as public API.

### F7 (P3) — duplicated `TabsTrigger` className repeated verbatim ×4
- **Location** `apps/web/src/app/routes/_app/projects/$projectId.lazy.tsx:150,154,160,166`.
- **Description** The exact string
  `"px-0.5 pb-2.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-active:font-semibold data-active:text-foreground"`
  is repeated on all four `TabsTrigger`s.
- **Impact** Style drift risk — a tweak to one tab's look can silently diverge
  from the others.
- **Recommended fix** Hoist to a module-level `const TAB_TRIGGER_CLASS` and reuse.

### F8 (P3) — presentational components `-project-cover-field.tsx` and `-project-stats.tsx` untested
- **Location** `apps/web/src/app/routes/_app/projects/-project-cover-field.tsx`,
  `apps/web/src/app/routes/_app/projects/-project-stats.tsx:19-54`.
- **Description** Neither has a test. `-project-stats.tsx` `StatCard` has a real
  branch (button-with-`aria-pressed` filter chip vs static div, lines 32-53) that
  is unexercised. `-project-cover-field.tsx` handles cover upload UI. Both are
  largely presentational, hence low severity, but the StatCard interactive branch
  and cover-field upload/clear handlers are logic worth a smoke test.
- **Impact** Low — display-only; the interactive `StatCard` filter-chip branch is
  the only untested behavior of note.
- **Recommended fix** Add a minimal render test for `StatCard` covering both the
  `onClick`/`active` (button) and static (div) branches; optionally a smoke test
  for `-project-cover-field.tsx` upload/remove handlers.

### F9 (P3) — two narrow branch gaps: category PATCH-missing 404 and cover-hook admin bypass
- **Location**
  `apps/api/src/modules/project/project.routes.ts:422-430` (category PATCH);
  `apps/api/src/modules/project/project.cover.permission.ts:16,22` (admin bypass);
  cf. existing tests `project.routes.test.ts:526` and `project.cover.test.ts:127-149`.
- **Description** (a) The procurement-category route test
  (`project.routes.test.ts:526`) exercises create/patch/delete and a
  **DELETE**-missing → 404, but not **PATCH** on a missing category id (the
  `updateCategory` → `undefined` → `NotFoundError` path at routes.ts:427-428).
  (b) The cover permission hook test asserts member / outsider / `project.manage`
  paths but always with `role: "user"`; the `actor.role === "admin"` early-return
  branches (permission.ts:16, 22) are not asserted.
- **Impact** Low — both are simple branches adjacent to well-tested code, but they
  are genuine uncovered lines.
- **Recommended fix** Add a PATCH-on-missing-category assertion to the existing
  category route test, and an admin-actor assertion to the cover-hook test.

---

## Areas checked and clean (no issues)

- **Dead/commented-out code**: No `TODO`/`FIXME`/`XXX`/`HACK` markers and no
  leftover commented-out code blocks in the project or tag modules. The
  `/* eslint-disable ... */` directives present (e.g.
  `-project-settings-general.tsx:42`, `-project-form-dialog.tsx:46`,
  `react-refresh/only-export-components` on route files) are intentional and
  justified, not stale.
- **`*.backup.ts` files**: live and registered (see Premise correction above) —
  not dead code.
- **Service composers / exports** (`composeProject`, `composeMember`,
  `composeRole`, `composeCategory`, `composeGlobalCategory`) are all consumed by
  the routes; no unused project-service exports found.
- **Tag assignment helpers** (`listResourceTagViews`, `listResourceTagNames`,
  `listResourceIdsByAnyTag`, `loadResourceTagsByResource`, `syncResourceTagsTx`,
  `deleteResourceTags`) are each consumed by issue/procurement/contact/document
  services — not dead.
- **`status-colors.ts` / `priority-signal.tsx`**: clean constant maps / small
  components consumed widely; no dead exports. `priority-signal.tsx` lacks a
  dedicated test but is exercised indirectly through the issues/procurement tab
  tests (its only two consumers) — not flagged.
- **`index.lazy.tsx`** (project list) IS tested (`-project-list.test.tsx` imports
  `ProjectsListPage`).
- **Tiny route stubs** (`$projectId.issues.tsx`, `$projectId.files.tsx`, etc.,
  ~130-160 B `createFileRoute` wrappers) are not worth dedicated tests — excluded
  by design, not flagged.
