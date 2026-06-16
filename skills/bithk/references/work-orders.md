# Work orders (issues) — detailed parameters

Work orders are the `issue` resource, nested under a project. Scope module:
`projects` (`read` for GET, `write` for POST/PATCH/DELETE). All paths are under
`$BITHK_URL`; send `Authorization: Bearer $BITHK_TOKEN`.

Source of truth: `apps/api/src/modules/issue/issue.routes.ts` (Zod schemas) and
`apps/api/src/modules/item/comment.routes.ts` (comments). When in doubt, a bad
body returns `422 { error: { code:"VALIDATION_ERROR", details } }` naming the
bad fields.

## ID model (important)

- A work order's `:id` in the URL is its **shortId** — the same value returned
  as `id` by the list/detail endpoints. Don't use the internal item id.
- `assigneeMemberId` is a **`project_members.id`**, NOT a user id. Resolve it
  from `GET /projects/:projectId/members` (each member row has `id` + the
  user's name). Omit to leave unassigned.
- Enums: `status` ∈ `todo | working | review | done | cancel`;
  `priority` ∈ `low | medium | high | urgent`.

## Create — `POST /projects/:projectId/issues`

Body (`title` required, rest optional):

| Field | Type | Notes |
|---|---|---|
| `title` | string (1–500) | required |
| `description` | string (≤2000) | |
| `status` | enum | default `todo` |
| `priority` | enum | default `medium` |
| `assigneeMemberId` | string | a `project_members.id` |
| `dueDate` | string (≤30) | e.g. an ISO date `"2026-07-01"` |
| `tags` | string[] (≤50 items, each ≤50) | |

```bash
jq -n --arg t "Inspect ballast tanks" --arg d "Annual class survey item" \
  '{title:$t, description:$d, priority:"high", status:"todo", dueDate:"2026-07-01", tags:["survey"]}' > /tmp/i.json
api -X POST "$BITHK_URL/projects/$PID/issues" -H 'Content-Type: application/json' \
  --data-binary @/tmp/i.json | jq .data    # -> { id: <shortId>, title, status, priority, ... }
```

## List — `GET /projects/:projectId/issues`

Query: `?q=`, `?status=`, `?priority=`, repeated `?tagId=`, `?page=`, `?limit=`.
Returns `{ data: [...], meta: { total, page, limit, totalPages } }`. Each item:
`{ id (shortId), title, description, status, priority, assigneeId, assigneeMemberId, dueDate, tags, createdAt, ... }`.

## Detail — `GET /projects/:projectId/issues/:id`

`:id` = shortId. Returns the same per-issue shape as list items.

## Update — `PATCH /projects/:projectId/issues/:id`

Same fields as create, all optional; `description`, `assigneeMemberId`, and
`dueDate` are nullable (send `null` to clear). Send only what changes.

```bash
api -X PATCH "$BITHK_URL/projects/$PID/issues/$IID" -H 'Content-Type: application/json' \
  -d '{"status":"working","priority":"urgent"}' | jq .data
```

## Comments

- List: `GET /projects/:projectId/issues/:id/comments` →
  `{ data: [{ id, itemId, authorId, content, replyToId, isInternal, createdAt }] }`.
- Create: `POST /projects/:projectId/issues/:id/comments` — body
  `{ content: string (≤2000, required unless an attachment is included), replyToId?: string }`.
  The field is **`content`** (not `body`/`message`). A reply sets `replyToId`
  to another comment's id on the same issue.
- Delete: `DELETE /projects/:projectId/issues/:id/comments/:cid`.
- Comment attachments: `POST /projects/:projectId/issues/:id/comments/:cid/attachments`
  (multipart `file`); `GET .../attachments/:aid` downloads.

```bash
jq -n --arg c "Parts ordered; ETA Friday." '{content:$c}' > /tmp/c.json
api -X POST "$BITHK_URL/projects/$PID/issues/$IID/comments" -H 'Content-Type: application/json' \
  --data-binary @/tmp/c.json | jq .data
api "$BITHK_URL/projects/$PID/issues/$IID/comments" | jq '.data[] | {id, content, authorId, createdAt}'
```

## Attachments (issue-level)

- Upload: `POST /projects/:projectId/issues/:id/attachments`, multipart field
  **`file`** (≤ server upload limit; 413 `UPLOAD_TOO_LARGE` if over). Returns an
  `AttachmentView`: `{ id, fileId, ownerType, ownerId, filename, mimetype, size, createdBy, createdAt }`.
- List: `GET .../attachments`. Download: `GET .../attachments/:aid` (add
  `?inline=true` to render instead of download). Delete: `DELETE .../attachments/:aid`.

```bash
api -X POST "$BITHK_URL/projects/$PID/issues/$IID/attachments" -F "file=@./survey.pdf" | jq .data
api "$BITHK_URL/projects/$PID/issues/$IID/attachments/$AID" -o ./survey.pdf
```

## Pin / references

- `POST /projects/:projectId/issues/:id/pin` · `/unpin` — pin to the project
  overview.
- `GET/POST/DELETE /issues/:issueShortId/references[/:referenceId]` — link a
  ship/global worklist (or other reference) to the work order.
