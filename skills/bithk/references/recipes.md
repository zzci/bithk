# bithk recipes

All commands assume `$BITHK_URL` (API root) and `$BITHK_TOKEN` are set. Define a
helper once per shell:

```bash
api() { curl -s -H "Authorization: Bearer $BITHK_TOKEN" "$@"; }
```

## Bodies: never inline free-form text

Quotes/`$`/backticks/newlines in titles or descriptions break `-d '{...}'`.
Build the JSON with `jq` and POST a file:

```bash
jq -n --arg title "$TITLE" --arg desc "$DESC" '{title:$title, description:$desc}' > /tmp/body.json
api -X POST "$BITHK_URL/projects/$PID/issues" -H 'Content-Type: application/json' \
  --data-binary @/tmp/body.json | jq .data
```

Fixed-value bodies are safe to inline: `-d '{"status":"working"}'`.

## Discovering exact parameters

Request/response field names are defined by Zod schemas in the API source — the
authoritative reference. Three ways to find them:

1. **Read the schema** (this skill ships in the repo). Each module's
   `apps/api/src/modules/<module>/*.routes.ts` holds the `z.object({...})`
   create/update schemas and the route handlers. Work-order fields and enums
   are detailed in `work-orders.md`.
2. **Let a 422 tell you.** A bad body returns
   `{ success:false, error:{ code:"VALIDATION_ERROR", message, details } }`
   where `details` lists the offending fields — fix and retry.
3. **Echo a GET first.** `GET` the collection/resource and mirror the field
   names it returns when building a `POST`/`PATCH` body.

## Pagination & filtering

List endpoints accept `?page=` & `?limit=` and return
`{ data, meta: { total, page, limit, totalPages } }` (shape varies; inspect with
`jq`). Common filters: issues accept `?q=`, `?status=`, `?priority=`, repeated
`?tagId=`; projects/contacts accept `?q=` and repeated `?tagId=`.

```bash
# issue status enum: todo | working | review | done | cancel
api "$BITHK_URL/projects/$PID/issues?status=working&priority=high" | jq '.data[] | {id,title,status}'
```

## Multipart upload & download

Upload uses a `file` field (not JSON):

```bash
api -X POST "$BITHK_URL/drive/files/upload" -F "file=@./report.pdf" | jq .data
# into a folder:
api -X POST "$BITHK_URL/drive/files/upload" -F "file=@./report.pdf" -F "parentEntryId=$FOLDER_ID" | jq .data
```

Attach to a domain object (same `file` field on its `/attachments` route):

```bash
api -X POST "$BITHK_URL/projects/$PID/issues/$IID/attachments" -F "file=@./photo.jpg" | jq .data
```

Download attachment / file bytes (binary — drop `-s` pipe to `jq`):

```bash
api "$BITHK_URL/files/$FILE_ID/content" -o ./downloaded.bin
```

## ids: list before you act

Discover ids by listing; never guess. Ships are keyed by `shortId`:

```bash
PID=$(api "$BITHK_URL/projects" | jq -r '.data[0].id')
SHIP=$(api "$BITHK_URL/ships" | jq -r '.data[0].shortId')
```

## Per-module quick recipes

```bash
# Create a project (projects:write)
jq -n --arg n "MV Aurora overhaul" '{name:$n}' > /tmp/p.json
api -X POST "$BITHK_URL/projects" -H 'Content-Type: application/json' --data-binary @/tmp/p.json | jq .data

# Create a work order (projects:write). Full body in work-orders.md.
# status: todo|working|review|done|cancel  priority: low|medium|high|urgent
jq -n --arg t "Inspect ballast tanks" '{title:$t, priority:"medium", status:"todo"}' > /tmp/i.json
api -X POST "$BITHK_URL/projects/$PID/issues" -H 'Content-Type: application/json' --data-binary @/tmp/i.json | jq .data

# Comment on a work order — field is `content` (projects:write)
jq -n --arg c "Parts ordered, ETA Friday." '{content:$c}' > /tmp/c.json
api -X POST "$BITHK_URL/projects/$PID/issues/$IID/comments" -H 'Content-Type: application/json' --data-binary @/tmp/c.json | jq .data

# List comments on a work order (projects:read)
api "$BITHK_URL/projects/$PID/issues/$IID/comments" | jq '.data[] | {id, content, authorId, replyToId, createdAt}'

# Move a work order's status (fixed body is safe to inline)
api -X PATCH "$BITHK_URL/projects/$PID/issues/$IID" -H 'Content-Type: application/json' -d '{"status":"working"}' | jq .data

# Create a contact (contacts:write)
jq -n --arg n "Acme Marine" '{name:$n, phone:"+1-555-0100"}' > /tmp/ct.json
api -X POST "$BITHK_URL/contacts" -H 'Content-Type: application/json' --data-binary @/tmp/ct.json | jq .data

# List a ship's equipment (ships:read)
api "$BITHK_URL/ships/$SHIP/equipment" | jq '.data[] | {id,name}'

# Global search (search:read)
api "$BITHK_URL/search?q=pump" | jq .data
```

## Error handling

```bash
RESP=$(api -w '\n%{http_code}' "$BITHK_URL/projects")
CODE=$(printf '%s' "$RESP" | tail -1); BODY=$(printf '%s' "$RESP" | sed '$d')
case "$CODE" in
  200|201) echo "$BODY" | jq .data ;;
  401) echo "Token missing/invalid/expired/revoked — mint a new one." >&2 ;;
  403) echo "$BODY" | jq -r '.error.code'  # TOKEN_SCOPE_INSUFFICIENT → widen the token's scope
       ;;
  *) echo "$BODY" | jq -r '.error.message // .' >&2 ;;
esac
```
