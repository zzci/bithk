---
name: bithk
description: Drive the bithk REST API as an authenticated user with a Personal Access Token. Use when the user wants an AI agent or script to create work orders, upload files, or operate any bithk module (projects, ships, contacts, procurement, documents, drive, HR, …) over HTTP with a `bithk_pat_…` token.
---

# bithk

Operate bithk by sending HTTP requests to `$BITHK_URL` (the API root, e.g.
`https://bit.localhost/api` or `http://localhost:1355/api`) authenticated with a
Personal Access Token in `$BITHK_TOKEN` (a `bithk_pat_…` secret).

Keep this entry file small. Load `references/*` only when the task needs them.

## Always-On Rules

1. Confirm `$BITHK_URL` and `$BITHK_TOKEN` before any request. If either is
   missing, ask for it. Never print the token back to the user.
2. Send `Authorization: Bearer $BITHK_TOKEN` on every request. PATs are
   cookie-free, so **no CSRF header is needed** (unlike a browser session).
3. Prefer `curl -s` piped to `jq`. Every response is `{ "success": true, "data": … }`
   or `{ "success": false, "error": { "code", "message" } }`.
4. The token's power is `the owner's permissions ∩ the token's scope`. A
   `403 TOKEN_SCOPE_INSUFFICIENT` means the token lacks the module/level for
   that route — the user must mint a token with the right scope (see below).
   A `401` means the token is missing, invalid, expired, or revoked.
5. Resources are addressed by a short id in the URL (e.g. a ship `shortId`, a
   project id). List first to discover ids; don't guess them.
6. File uploads are `multipart/form-data` with a `file` field — use `curl -F`,
   never a JSON body. See `references/recipes.md`.
7. Never inline free-form text (titles, descriptions, names) into `-d '{...}'` —
   quotes, `$`, backticks, and newlines get mangled by shell + JSON escaping.
   Build the body with `jq` and POST it with `--data-binary @file`. Fixed-value
   bodies (e.g. `{"status":"in_progress"}`) are safe to inline.

## Tokens & Scopes

A token is created in the bithk web app — **Settings → API tokens** (self) or,
for any user including virtual users, **Admin → Users → API tokens**. It is
shown once at creation; store it in `$BITHK_TOKEN`.

Each token grants a per-module level: `read` (GET only), `write` (read + create
/update/delete), or none. The scope module keys are listed in
`references/api-catalog.md`. `GET /account/me` always works (identity probe)
regardless of scope.

```bash
# Who am I? (verify the token)
curl -s "$BITHK_URL/account/me" -H "Authorization: Bearer $BITHK_TOKEN" | jq .data
```

## Quick Workflows

### Create a work order (issue) on a project

```bash
# 1. Find the project id (needs `projects:read`)
curl -s "$BITHK_URL/projects" -H "Authorization: Bearer $BITHK_TOKEN" | jq '.data[] | {id, name}'

# 2. Create the work order (needs `projects:write`). Build the body with jq.
jq -n --arg title "Replace bilge pump" --arg desc "Pump #2 failed inspection" \
  '{title:$title, description:$desc, priority:"high"}' > /tmp/bithk-issue.json
curl -s -X POST "$BITHK_URL/projects/<projectId>/issues" \
  -H "Authorization: Bearer $BITHK_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @/tmp/bithk-issue.json | jq .data
```

### Upload a file and attach it

```bash
# Upload to the drive (needs `drive:write`); field name is `file`.
curl -s -X POST "$BITHK_URL/drive/files/upload" \
  -H "Authorization: Bearer $BITHK_TOKEN" \
  -F "file=@./report.pdf" | jq .data

# Attach a file to a work order (needs `projects:write`).
curl -s -X POST "$BITHK_URL/projects/<projectId>/issues/<issueId>/attachments" \
  -H "Authorization: Bearer $BITHK_TOKEN" \
  -F "file=@./report.pdf" | jq .data
```

## References

- `references/api-spec.json` — the **complete, authoritative OpenAPI 3.1
  spec** for every endpoint: exact request body / query / path params (with
  types, enums, required flags), response shapes, and the bearer security
  scheme. Generated from the live routes (`hono-openapi`), so it never drifts.
  This is the source of truth for parameters — load and query it (e.g. with
  `jq '.paths["/projects/{projectId}/issues"].post'`) when you need a route's
  exact shape; it works standalone, no codebase access required.
- `references/work-orders.md` — a worked walkthrough of the work-order (issue)
  lifecycle (create/list/update, `status`/`priority` enums, `assigneeMemberId`,
  comments where the field is `content`, attachments). Read this for the
  "create / comment on a work order" flow.
- `references/api-catalog.md` — human-readable module map: each module's base
  paths and scope key. Use it to find *which* endpoint, then `api-spec.json`
  for its exact parameters.
- `references/recipes.md` — pagination & filtering, multipart upload, downloads,
  shortId-vs-id, comments/attachments, a per-module recipe set, and how to
  resolve a 422 from its `error.details`.
