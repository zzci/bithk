# PLAN-047 Project list/dialog UI polish round

- **status**: Completed
- **owner**: l1-75ymcfnr / L2 vwfwi45t
- **campaignId**: l1-75ymcfnr-uipolish-20260602015825
- **tasks**: [FIX-020](../task/FIX-020.md), [FIX-021](../task/FIX-021.md), [FIX-022](../task/FIX-022.md), [FIX-023](../task/FIX-023.md)
- **createdAt**: 2026-06-02

## Goal

Three disjoint frontend UI polish workstreams on the project module surfaces.
Each is implemented in its own isolated L3 worktree.

### A — Create-issue dialog refinements (FIX-020)

File: `apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx`
(`CreateIssueDialog`), plus any changed `issues.*` strings in `projects.json`.

1. Remove the top breadcrumb bar (`{projectName} › 手动创建`). Float the
   maximize (⤢) + close (×) controls at the dialog top-right (still working);
   the body starts directly with the title input then description.
2. The maximize (⤢) control expands the DESCRIPTION editing area (taller
   textarea), not merely the shell.
3. Remove the read-only `项目 / {projectName}` pill (last pill after 截止日期);
   in its place add an ATTACHMENT button that uploads attachments to the new
   issue. Consolidate attachments to ONE entry point: remove the bottom-left
   paperclip; the metadata-row attachment button is the single affordance.
4. Tighten the bottom bar padding (more compact). Footer becomes just
   [继续创建 toggle][创建 issue].

### B — Tag-filter selector redesign (FIX-021)

Files: `-project-tag-filter.tsx` + `-project-tag-filter-logic.ts` + its test.

Replace inline preset chips (cap 7) + "More" overflow with a single tag
SELECTOR control (combobox/dropdown listing ALL tags with checkable state) and
the SELECTED tags rendered as removable chips (X to deselect) to the RIGHT of
the selector. Remove the inline-fit measuring logic (`MAX_INLINE_CHIPS`,
`computeVisibleTagCount`, `ResizeObserver`). Keep public props/signatures
UNCHANGED so the 3 consumers (issues tab, procurement tab, projects list
`index.lazy.tsx`) need no edits. Single-select = one removable chip. Resolves
prior audit 01-F9 overflow nit. Update `-project-tag-filter.test.tsx`.

### C — Procurement filter all-labels rename (FIX-022)

File: `-project-procurement-tab.tsx` + `locales/{en,zh}/projects.json`.

Rename the three ToolbarFilter `allLabel` values (shorter):
- 全部状态 → 状态 (en: All statuses → Status)
- 全部优先级 → 优先级 (en: All priorities → Priority)
- 全部分类 → 分类 (en: All categories → Category)

Keys: `procurement.allStatuses` / `procurement.allPriorities` /
`procurement.allCategories` in BOTH en and zh (parity guard stays green).

### D — Projects home filter row unification (FIX-023) [scope addition v2]

File: `index.lazy.tsx` + `locales/{en,zh}/projects.json` (new label key).

Unify the projects-home filter bar into ONE "筛选:" chip row: leading label,
正常/已归档 as tag-style chip buttons (count badges kept, toggle unchanged), the
redesigned tag selector (from FIX-021) and removable selected tag chips — all
one consistent chip visual. Behavior identical. deps=[B] (consumes B's
ProjectTagFilter); disjoint file from A and C.

## DAG

- A (FIX-020) deps=[] — `-project-issues-tab.tsx` + `projects.json` (issues.*)
- B (FIX-021) deps=[] — tag-filter trio (no locale)
- C (FIX-022) deps=[A] — `-project-procurement-tab.tsx` + `projects.json`
  (procurement.*). Serialized after A because both edit `projects.json`.
- D (FIX-023) deps=[B] — `index.lazy.tsx` + `projects.json` (new label).
  Consumes B's redesigned ProjectTagFilter; disjoint file from A/C so runs
  parallel to A once B merges.

A and B dispatch in parallel; C after A merges; D after B merges.

## Acceptance Criteria

- A: no breadcrumb bar; ⤢/× float top-right and both work; ⤢ grows the
  description textarea; project pill replaced by a working attachment button;
  exactly one attachment entry point (no paperclip); footer = toggle + submit,
  tighter padding; en/zh parity preserved.
- B: single selector lists ALL tags with checkable state; selected tags show as
  removable chips to the right; measuring logic removed; public props unchanged;
  all 3 consumers compile untouched; test updated and green.
- C: the three procurement filter triggers show the shortened all-labels in
  en + zh; parity guard green.
- `bun run check` exits 0 (the `@milkdown/ctx` removeEventListener teardown in
  `-project-issue-panel.test.tsx` is a KNOWN FLAKE — grep to confirm before
  treating a test exit 1 as real).

## Out of Scope

- No backend changes.
- No status enum / status color changes.
- No priority-level changes.
