# PLAN-118 Per-actor write rate limit

- Status: completed
- Approved: 2026-09-15 (user: create bucket at 30/min + 300/h)
- Task: [FEAT-064](../task/FEAT-064.md)

## Context and scope

Rate limiting exists in the repo but only on three unauthenticated surfaces:

- `checkAuthRateLimit` (`account/auth/lockout.service.ts:136`) — per IP, login.
- `rateLimit({ bucket: "totp-stepup" })` (`account/users/users.routes.ts:301`).
- `rateLimit({ bucket: "share-public" })` (`share/share.public.routes.ts:78`)
  — 120/min per IP.

The authenticated write surface has none. There are 184 mutating handlers under
`modules/**/*.routes.ts`, every one of which also writes an `audit` row. A
looping client (a broken integration, a retried job, a Personal Access Token
script) can therefore create business records and audit rows at whatever rate
the process answers.

Building blocks reused rather than reinvented:

- `shared/middleware/rate-limit.ts` — fixed-window counter, per-bucket map,
  background GC timer, `MAX_ENTRIES_PER_BUCKET` eviction, and the
  `429 RATE_LIMITED` + `Retry-After` response shape. Today it keys on
  `getClientIp` only.
- `shared/module-manifest.ts` — precedent for classifying protected routes by
  path inside shared middleware.
- `routes/protected.ts` — already mounts two cross-cutting guards
  (`moduleGate`, `apiTokenScopeGuard`) before the module routers.
- `apps/web/src/shared/lib/http.ts` — already parses `Retry-After` into
  `HttpError.retryAfter`, so SPA calls through it surface a 429 with the
  server's message.

Measured constraint that shaped the tiers: the issue panel
(`-project-issue-panel.tsx`) patches **one field per request** — seven `patch()`
call sites (title, description, status, priority, assignee, due date, tags).
Triaging four work orders inside a minute is ~24 writes, so a flat 20/min
ceiling on all writes would break routine use. Creation is the operation worth
holding to a human pace, and it is also the one the task is about.

## Proposal

### 1. Key the limiter by actor, not by IP

`rate-limit.ts` gains two optional options, leaving every current call site
unchanged:

- `key?: (c) => string` — bucket key resolver, defaulting to today's
  `getClientIp(...) ?? "anon"`.
- `max: number | ((c) => number)` — so the budget can come from request config
  instead of being frozen at route-construction time.

Writes key on the actor (`user:<id>`, falling back to `ip:<ip>` when no actor
resolves): one user cannot spend a colleague's budget from behind a shared NAT
egress, and rotating IPs does not buy a script a fresh budget.

### 2. `writeRateLimit()` mounted once on the protected router

New `shared/middleware/write-rate-limit.ts`:

- Passes `GET` / `HEAD` / `OPTIONS` through untouched — reads create no records.
- Resolves the actor idempotently (`c.get("user")`, else `getAuthProvider()`,
  caching into `c.var.user`), exactly as `moduleGate` does. No extra query: it
  performs the load `authRequired` would have done.
- Classifies the request into one of three buckets, then delegates to
  `rateLimit`.
- Mounted in `routes/protected.ts` after `moduleGate()` and
  `apiTokenScopeGuard()`, so module concealment (404) still wins over a 429.

### 3. Three buckets

| bucket | surface | default | env |
| --- | --- | --- | --- |
| `create` | business-record creation (list below) | 30/min **and** 300/h | `CREATE_RATE_LIMIT_PER_MINUTE`, `CREATE_RATE_LIMIT_PER_HOUR` |
| `write` | every other mutating route — `PATCH`/`PUT`/`DELETE` and action `POST`s | 60/min | `WRITE_RATE_LIMIT_PER_MINUTE` |
| `write-bulk` | `/drive`, `/files`, `/backup` prefixes; paths ending `/attachments`, `/attachments/presign`, `/attachments/confirm`, `/cover`, `/import` | 600/min | `BULK_WRITE_RATE_LIMIT_PER_MINUTE` |

`create` matches a `POST` whose path ends with one of an explicit list:
`/issues`, `/procurements`, `/equipment`, `/worklists`, `/projects`,
`/children`, `/documents`, `/contacts`, `/comments`, `/hr/colleagues`,
`/hr/approvals`, `/hr/payroll`. Concrete paths are matched (`/projects/ab12cd34/issues`),
so one suffix covers every parameterised mount, including the shared
`${prefix}/:id/comments` mount used by every item sub-type.

30/min is one new record every two seconds — a create dialog takes an order of
magnitude longer to fill — and the 300/h ceiling answers the "how many", not
just "how fast": it stops a slow loop that stays under the per-minute budget
from producing 40k records a day. An endpoint missing from the list falls into
`write` at 60/min, so an omission is still bounded.

The `write-bulk` split exists because one human gesture there is not one
request: dragging a 300-file folder into the drive legitimately issues two
writes per file (presign + confirm) plus a folder create per directory. Those
routes are bounded by `MAX_UPLOAD_BYTES`, `UPLOADS_TOTAL_BYTES` and
`MAX_ATTACHMENTS_PER_RESOURCE` — a byte quota, not a frequency counter, is
their primary defence.

Any knob set to `0` disables its bucket. Windows are fixed (60s / 3600s); the
knob is the budget, so there is one number per dial to reason about.

### 4. Client backoff on the one bulk path

`apps/web/src/shared/components/file/upload-queue.ts` drives the sequential
folder upload through its own `postJson` helper. It gains a bounded retry: on
`429`, wait `Retry-After` seconds (capped, at most two retries) and repeat.
Without it a fast localhost upload of many tiny files would surface per-file
errors instead of throttling. Everything else in the SPA goes through `http.ts`
and already reports the server's message.

### 5. Test harness

`tests/e2e/run.ts` boots the API with an explicit env block; every knob is set
to `0` there. The suite hammers a single admin actor far past any human pace, so
leaving the limiter on would make it a flake generator rather than a test of the
limiter. The middleware's own behaviour is covered by unit tests instead.

## Risks

- **A legitimate flow trips a limit.** Mitigated by the three tiers, the client
  backoff, and the env knobs; a deployment that hits it turns the number up
  without a code change.
- **In-memory state.** Buckets live in the process, like every existing limiter
  here. Multiple replicas each carry their own budget (effective limit scales
  with replica count) and a restart clears counters. Acceptable for the
  single-process deployment this app ships as; noted, not solved.
- **PAT integrations.** A token-driven integration creating faster than 30/min
  now gets 429s. Intended, but a behaviour change for existing automation — the
  `Retry-After` header makes it recoverable.
- **Drive entry creation stays in the loose bucket.** `POST /drive/folders` and
  `/drive/entries/text-file` are records too, capped at 600/min rather than 30.
  They share a gesture with bulk upload and are bounded by the storage quota.
- **Actor resolution on unauthenticated requests.** Falls back to the IP key, so
  an anonymous flood against a protected path is still bounded.

## Scope

- `apps/api/src/config/schema.ts` — four knobs
- `apps/api/src/shared/middleware/rate-limit.ts` — optional `key` + callable `max`
- `apps/api/src/shared/middleware/write-rate-limit.ts` (+ test) — new
- `apps/api/src/routes/protected.ts` — one mount line
- `apps/web/src/shared/components/file/upload-queue.ts` — 429 backoff
- `tests/e2e/run.ts` — disable the limiter for the live suite
- `.env.example` + regenerated `docs/reference/env-reference.md`
- `docs/changelog.md`
- No schema, migration, or backup-registry change

## Alternatives considered

- **Per-route limiters.** Explicit, but 184 mount points that a new route
  silently forgets. Rejected.
- **One bucket for everything.** Any value that survives a bulk folder upload
  (>=10/s) is too loose to be a human pace; any human pace breaks the upload,
  and a per-field-patch panel breaks at a create-shaped ceiling. Rejected.
- **Token bucket instead of fixed window.** Smoother, and it would absorb bursts
  without the bulk bucket — but it means a new algorithm next to the existing
  fixed-window limiter rather than reusing it. Rejected as premature.
- **Persist counters in SQLite** (as `auth_lockouts` does). Survives restart and
  is shared across replicas, at the cost of a write per request — the opposite
  of what flood control should do. Rejected.

## Results

- `rate-limit.ts` was split rather than parameterised: the counting core moved
  into `consumeRateLimit({ bucket, key, windowMs, max })` (returns 0 or the
  seconds to wait) with `rateLimited(c, seconds)` holding the shared 429
  envelope. `rateLimit()` keeps its exact previous signature and behaviour, so
  the three existing per-IP call sites are untouched. The plan's "optional
  `key` + callable `max`" shape was tried first and abandoned: it forced the
  write limiter to nest one middleware inside another's `next`, which Hono's
  `Next` type (`() => Promise<void>`) rejects for a handler that may return a
  `Response`.
- RED: ten cases in `write-rate-limit.test.ts` failed on the missing module.
  GREEN: the middleware classifies a request into `create` / `write-bulk` /
  `write` and charges the budgets in order via `charge()`. 100% function and
  line coverage on the new file.
- Bulk classification ended up matching `/attachments` anywhere in the path
  (the real mounts are `/attachments`, `/attachments/presign-upload`,
  `/attachments/confirm-upload`, `/attachments/from-drive`) plus the concrete
  upload suffixes `/cover-image`, `/project-default-cover`, `/avatar`. The
  plan's `/import` suffix was dropped — no such route exists; the backup
  imports are already covered by the `/backup` prefix.
- An integration test in `contact.routes.test.ts` drives the **real**
  `protectedRoutes()` with a 2/min create budget and asserts 201, 201, 429 +
  `Retry-After` + `RATE_LIMITED`, then a 200 read. Unit tests alone would not
  have caught a mis-mount.
- Three hand-written `Config` fixtures needed the new knobs
  (`route-harness.ts`, `auth.routes.test.ts`, `contact.routes.test.ts`); only
  the last is typed strictly enough that typecheck flagged it. The duplication
  between those three fixtures is pre-existing and was left alone.
- `upload-queue.ts` retries a 429 twice, honouring `Retry-After` (capped at
  65s), in both the presign/confirm JSON path and the multipart XHR path;
  `createFolder` moved onto the same `postJson` helper so a bulk folder upload
  inherits the backoff instead of failing a directory create.
- Documented in `docs/reference/api.md` (new "Write rate limits" section) and
  `.env.example` / the regenerated `env-reference.md`.
- `bun run check` passed: lint (0 errors, 17 pre-existing warnings), typecheck
  across all workspaces, 2273 api + 1029 web + 28 spreadsheet tests, both
  builds, and every doc-drift check. `bun run test:e2e` passed 109/109 with the
  limiter disabled by the four `0` knobs in `tests/e2e/run.ts`.
