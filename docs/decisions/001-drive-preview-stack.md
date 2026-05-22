# 001 — Drive faithful-preview rendering stack & UI divergences

- Status: accepted
- Date: 2026-05-22
- Review by: 2026-11-22
- Scope: `apps/web` drive UI (`-file-preview-dialog.tsx`, the shared
  `-drive-file-list-surface.tsx`, and the `context-menu` UI primitive)

## Context

The drive web UI reproduces a faithful in-app file viewer (image / PDF /
markdown / code / text) and a reusable file-list surface shared by every
drive consumer. Achieving this required new frontend dependencies and two
deliberate departures from the project's default UI conventions. This
record captures what was added, why, and when to revisit it.

## Decision

### (a) New frontend dependencies (lazy-loaded)

Added to `apps/web/package.json`:

| Package | Version | Purpose |
| --- | --- | --- |
| `react-pdf` | `10.4.1` | Paged `<Document>`/`<Page>` PDF rendering |
| `pdfjs-dist` | `5.4.296` | PDF engine + worker — **pinned to the exact version `react-pdf@10.4.1` bundles** |
| `react-zoom-pan-pinch` | `4.0.3` | Image zoom / pan / rotate / reset |
| `shiki` | `4.1.0` | Theme-synced syntax highlighting for code/markdown source |

All four are **lazy-loaded** via dynamic `import()` (and, for the pdf
worker, a Vite `?url` import) inside the preview dialog only. They never
enter the route shell or the shared vendor chunk — only the matching
async chunk is fetched when a user opens that kind of file.

**`pdfjs-dist` pin rationale:** `react-pdf` couples tightly to a specific
pdf.js API; a mismatched `pdfjs-dist` breaks the worker contract. The
version is pinned to exactly what `react-pdf@10.4.1` expects and must be
bumped together with `react-pdf`, never independently.

### (b) Custom full-bleed overlay modal instead of shadcn `Dialog`

The preview viewer uses a hand-rolled fixed-overlay modal
(`fixed inset-0 z-50 …`, `role="dialog"`) rather than the shadcn/base-ui
`Dialog`. The original product surface is a full-bleed viewer (edge-to-edge
canvas, custom toolbar, optional thumbnail rail, fullscreen toggle); the
constrained, centered, padded shadcn `Dialog` content box fights that
layout. The custom overlay keeps Escape-to-close, backdrop click, and
focus semantics while owning the full viewport.

### (c) New `context-menu` UI primitive backed by `@base-ui/react`

Added `apps/web/src/shared/components/ui/context-menu.tsx` wrapping
`@base-ui/react/context-menu`. The shared file-list surface needs native
right-click context menus (per-row actions + blank-area create menu);
shadcn base-nova ships no context-menu primitive, so we added one in the
same wrapper style as the other `ui/*` primitives. This stays within the
hard-locked UI stack (shadcn base-nova + `@base-ui/react`) — no Radix or
other UI ecosystem is introduced.

## Consequences

- Bundle: heavy preview deps stay out of the initial load; first open of a
  PDF/code/markdown file pays a one-time async chunk fetch.
- Maintenance: `react-pdf` + `pdfjs-dist` upgrade in lockstep; the pdf
  worker URL wiring (`pdfjs-dist/build/pdf.worker.min.mjs?url`) must remain
  a Vite asset import.
- The custom overlay modal is a local divergence from the shadcn `Dialog`
  default; if base-nova later ships a full-bleed dialog variant, revisit.

## Review

Revisit by **2026-11-22**: confirm the dep pins are still current, that the
custom overlay is still needed (vs. a shadcn full-bleed variant), and that
the context-menu primitive has not been superseded upstream.
