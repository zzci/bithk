# PLAN-049 Create-issue dialog staged-attachment list

- **status**: Completed
- **owner**: l1-75ymcfnr / L2 xps1yt40
- **campaignId**: l1-75ymcfnr-attach-20260602042448
- **tasks**: [FIX-026](../task/FIX-026.md)
- **createdAt**: 2026-06-02

## Goal

The create-issue dialog (`CreateIssueDialog` in
`apps/web/src/app/routes/_app/projects/-project-issues-tab.tsx`) already stages
picked files in `files` state and uploads them to the new issue in the create
`onSuccess` handler, but the staged files are **invisible** — the only signal is
a `· N` count on the attachment pill. The user cannot review which files are
staged nor remove a wrong pick before submitting.

Render a compact list of the currently staged attachments at the **bottom of the
description editing area** (between the metadata pill row and the sticky footer).
Each entry shows the file name (+ optional size/icon) and a remove control (a
real `Button` with an `aria-label`) that drops that single file from the staged
list **in memory only — no server call** (the issue does not exist yet). The
list clears after a successful create exactly as it does today. Reuse the
existing attachment chip/file-row styling
(`apps/web/src/shared/components/resource/attachment-section.tsx`, incl. its
exported `formatFileSize`) for visual consistency.

## DAG

- FIX-026 deps=[] / L3=TBD — sole owner of `-project-issues-tab.tsx`
  (`CreateIssueDialog` only) + the new `issues.composer.removeAttachment` key in
  `locales/{en,zh}/projects.json`. Single-node DAG, no parallelism.

## Acceptance Criteria

- When `files.length > 0`, a staged-attachment list renders below the
  description area; each row shows the file name (+ size) and an `X` remove
  `Button` with an `aria-label`.
- Clicking remove drops only that file from `files` state (no network request);
  the pill count + list update accordingly.
- The list is gone when no files are staged and clears after a successful create
  (existing `reset()` behavior unchanged).
- No backend changes; the upload-on-create flow in `submit`/`onSuccess` is
  untouched.
- en/zh i18n parity for the new string(s); `i18n-parity.test.ts` passes.
- `bun run check` exits 0 (the `@milkdown/ctx` removeEventListener teardown in
  `-project-issue-panel.test.tsx` is a KNOWN FLAKE — grep to confirm before
  treating a test exit 1 as real; run `bun install` first if a fresh worktree
  errors 127).

## Scope Addition (v2, user-approved 2026-06-02)

Same component, folded into the same L3 (j26jd761): the create-issue dialog has
excess empty padding below the sticky footer row — a large blank gap between the
footer (Create-more Switch + submit Button) and the dialog bottom edge. Tighten
it by adjusting only spacing/padding utility classes (DialogContent padding +
the footer's `-mx-4 -mb-4` negative margins) so the footer sits compactly at the
bottom with padding balanced against the other edges. Footer contents and the
staged-attachment list stay unchanged. `bun run check` still EXIT=0.

## Out of Scope

- Only the create-issue dialog staged-attachment UI. No backend changes, no
  change to the upload-on-create flow, no other components.
- Do not refactor `attachment-section.tsx` (read-only reuse of its exported
  `formatFileSize` is fine).

## Notes

- 2026-06-02 - PLAN created by L2 xps1yt40; one L3 dispatched (worktree).
