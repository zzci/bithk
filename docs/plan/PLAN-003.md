# PLAN-003 — Markdown editor source view toggle (CodeMirror)

- **status**: done
- **createdAt**: 2026-05-23
- **approvedAt**: 2026-05-23
- **relatedTask**: FEAT-003

## Context

`shared/components/editor/milkdown-editor.tsx` is a pure WYSIWYG editor.
Markdown is only an internal storage format; `lastEmittedRef.current` always
holds the latest serialised markdown (kept current by `listenerCtx
.markdownUpdated`). There is no way to view or edit the raw markdown source.

Milkdown has **no** document-level source plugin — its CodeMirror integration
(`@milkdown/components/code-block`) only powers code blocks. CodeMirror 6
(`@codemirror/state`, `@codemirror/view`, `@codemirror/lang-markdown`,
`codemirror`) is already in `bun.lock` as a transitive dependency of that
component, so adding an editable source view adds no net bundle weight.

## Proposal

Approach: a CodeMirror-backed editable source view, toggled in-place.

- **Dependencies** (promote transitive → direct in `apps/web/package.json`):
  `codemirror`, `@codemirror/lang-markdown`, `@codemirror/state`,
  `@codemirror/view`.
- **New component** `markdown-source-view.tsx`: editable CodeMirror 6 instance,
  `markdown()` language, line wrapping. Seeded from current markdown; an
  `updateListener` writes edits back to `lastEmittedRef` and fires `onChange`.
- **`milkdown-editor.tsx`**: `sourceMode` state in `EditorBody`. Milkdown stays
  mounted; source view overlays the editing shell when `sourceMode`.
  - WYSIWYG → source: seed CodeMirror from `lastEmittedRef.current`.
  - source → WYSIWYG: `editor.action(replaceAll(buffer))` pushes edits back.
  - Toolbar shows only the toggle icon (`FileCode2`) in source mode.
- **Controlled `value`**: `ExternalValueSync` skips re-seeding while in source
  mode to avoid stealing the cursor.
- **i18n**: add `viewSource` / `backToEditor` to `editor.json` (en + zh).
- **Gating**: toggle only rendered when `!compact`.

## Risks

- Milkdown's remark serialiser normalises markdown, so round-tripping may
  reformat the source (list markers, spacing). Accepted at research stage.

## Scope

- Edit: `milkdown-editor.tsx`, `milkdown-editor.css`, `apps/web/package.json`,
  `locales/{en,zh}/editor.json`.
- Add: `markdown-source-view.tsx`.
- Unchanged: `index.tsx` (read-only path), `markdown-preview.tsx`, all callers.

## Alternatives

- **textarea + shiki** — net-new heavy dependency (TextMate grammar + oniguruma
  WASM), fragile transparent-overlay alignment under editing/wrapping. Rejected
  for an editable view; CodeMirror is already bundled and purpose-built.
- **read-only source display** — simpler, but the user requires editable source.
