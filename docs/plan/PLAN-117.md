# PLAN-117 Sibling navigation inside the drive preview dialog

- Status: completed
- Approved: 2026-09-14 (user: 开始)
- Task: [FEAT-063](../task/FEAT-063.md)

## Context and scope

`FilePreviewDialog` (`apps/web/src/shared/components/file/file-preview-dialog.tsx`)
renders exactly one `DriveEntry`. It already re-fetches whenever `entry.id`
changes (`loadFile` depends on it and resets zoom, rotation, page state and
edit mode), so stepping to another entry needs no change to the load path —
only a way to hand the dialog a different entry.

Ownership of the open action:

- `drive.lazy.tsx:99` `openPreview(entry, edit, canEdit)` is the single
  chokepoint for every drive list; it holds `previewEntry` and renders the
  dialog at page level.
- `-file-browser.tsx:203` `internalOpenPreview` is the same routing for
  surfaces that own their preview (project/ship file tabs).
- The folder listing itself lives in `-file-browser.tsx:171` (`entries`), which
  is also the only surface with a meaningful "current directory".

Out of scope: the public share page (`share/previews/drive-preview.tsx`, single
entry by construction) and the resource attachment section
(`resource/attachment-section.tsx`) — neither is the file manager, and both keep
today's single-entry dialog.

## Proposal

### 1. Navigation sequence helpers

New `apps/web/src/shared/components/file/file-preview-nav.ts`:

- `previewableSiblings(entries)` — keeps entries that have a `file`, are not
  Univer spreadsheets (`isUniverSheetEntry`, they open in their own editor) and
  whose `resolvePreviewKind` is not `unsupported`, preserving list order.
- `siblingAt(siblings, currentId, offset)` — returns the neighbour or `null`
  at either end, and `null` when the current entry is not in the sequence
  (e.g. an unsupported file opened from the same folder).

### 2. Dialog props

`FilePreviewDialog` gains two optional props:

- `siblings?: readonly DriveEntry[]`
- `onNavigate?: (entry: DriveEntry) => void`

When `siblings` holds more than one entry and the current entry is part of it,
the header renders previous / next `ToolButton`s plus a `current / total`
counter, disabled at the ends and while editing a text or markdown file. Both
buttons are absent when either prop is missing, so every other call site is
unchanged.

Keyboard: a `window` keydown listener (active only while the dialog is open and
navigation is available) maps `ArrowLeft` / `ArrowRight` to the same handlers.
It ignores the event when the target is an input, textarea or contenteditable
node, or when the dialog is in edit mode.

### 3. Threading the sequence

`onPreviewEntry` gains a fourth optional parameter `siblings`:

```ts
(entry: DriveEntry, edit?: boolean, canEdit?: boolean, siblings?: readonly DriveEntry[]) => void
```

- `-file-browser.tsx` passes `previewableSiblings(entries)` from its row-open
  handler only (create-file flows keep passing nothing), stores it for the
  internal dialog, and wires `onNavigate`.
- `drive.lazy.tsx` stores it in a `previewSiblings` state next to
  `previewEntry`, clears it on close, and passes both to the dialog.
- Lists with no directory context (recent, favorites, share lists, sidebar)
  keep calling the handler with three arguments and get no navigation.

The sequence is a snapshot taken at open time; a concurrent list refresh does
not rewrite it. A navigated-to entry that has since been trashed surfaces the
dialog's existing error state.

### 4. i18n

`preview.tools.previous` / `preview.tools.next` in
`apps/web/src/locales/{en,zh}/drive.json`.

## Verification

- New `file-preview-nav.test.ts`: filtering (folders, sheets, unsupported) and
  edge/`null` behaviour of `siblingAt`.
- `bun run --filter @app/web test`
- `bun run check`

## Risks

- Fourth positional parameter on `onPreviewEntry` — acceptable because it is
  optional and only one caller supplies it; an options object would touch every
  call site for no behavioural gain.
- Arrow keys are currently free in the dialog; the PDF renderer uses
  ctrl/meta-wheel for page navigation, so there is no conflict.
