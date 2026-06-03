# PLAN-062 Issues tab tag-filter label: 按标签筛选 -> 标签

- **status**: Implementing
- **owner**: l1-75ymcfnr / L2 v7tozyh2
- **campaignId**: l1-75ymcfnr-isstag-20260603191110
- **tasks**: [FIX-036](../task/FIX-036.md)
- **createdAt**: 2026-06-03

## Goal

Shorten the project issues (工单) tab tag-filter dimension label from
"按标签筛选" / "Filter by tag" to just "标签" / "Tags". The issues tab renders
`<ListFilter>` with a tag dimension `label: t("issues.tagFilter")`
(`apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx:325`). That key
currently holds the long phrase; changing the key value yields the shorter
label (it is also the dimension trigger/group aria-label).

## Current state

- `apps/web/src/locales/zh/projects.json:130` — `issues.tagFilter` = "按标签筛选".
- `apps/web/src/locales/en/projects.json:130` — `issues.tagFilter` = "Filter by tag".
- `apps/web/src/locales/{zh,en}/projects.json:192` — `procurement.tagFilter` =
  "按标签筛选" / "Filter by tag" — SEPARATE key, OUT OF SCOPE.
- `-project-issues-tab.test.tsx:172` asserts the tag-filter trigger button by
  `name: "Filter by tag"`.

## Scope / Constraints

- Edit ONLY the `issues.tagFilter` value in `locales/en/projects.json` and
  `locales/zh/projects.json` (zh → "标签", en → "Tags"). Key set unchanged;
  en/zh parity preserved.
- Do NOT touch `procurement.tagFilter` (line 192) or any `tagFilterMore*` keys.
- No component logic change — `-project-issues-tab.tsx` already reads the key.
- Update `-project-issues-tab.test.tsx` to assert the new label "Tags" wherever
  it asserts the old "Filter by tag" for the issues tab.
- Dev phase: breaking changes OK.
- Quality gate per L3: `bun run check` EXIT=0 (fresh worktree may need
  `bun install` first); only acceptable noise = the known @milkdown/ctx
  teardown flake (exit1 with 0 real test failures).

## Acceptance Criteria

- `issues.tagFilter` = "标签" (zh) / "Tags" (en); `procurement.tagFilter`
  unchanged at "按标签筛选" / "Filter by tag".
- en/zh key sets identical (only the two values changed).
- The issues-tab tag-filter trigger renders the label "Tags" / "标签"; the test
  asserting that label is updated and passes.
- `bun run check` EXIT=0 (modulo the @milkdown flake).

## Decomposition (1 L3)

1. **L3-1 i18n + test** — change `issues.tagFilter` value in
   `locales/{en,zh}/projects.json` and update the assertion in
   `-project-issues-tab.test.tsx` ("Filter by tag" -> "Tags"). Run
   `bun run check`.
