# FEAT-003 — Markdown editor source view toggle

- **Status:** Done
- **Plan:** [PLAN-003](../plan/PLAN-003.md)
- **Created:** 2026-05-23
- **Owner:** roy

## Scope

Add an editable markdown source view to the Milkdown editor, toggled by a
toolbar icon. Source view uses CodeMirror 6 (already bundled transitively via
Milkdown's code-block component) with markdown highlighting. Toggle switches
the same region between WYSIWYG and source (not a side-by-side split).

Edits in source mode write back into Milkdown on toggle-back. Only shown in
full (non-compact) mode.

## Verification

- `bun run check` clean (lint + typecheck).
- Manual: type in WYSIWYG, toggle to source → see markdown; edit source,
  toggle back → WYSIWYG reflects the edit; `onChange` fires in both modes.
