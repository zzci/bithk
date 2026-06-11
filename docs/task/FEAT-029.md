# FEAT-029 HTTP access log filtering via HTTP_LOG_LEVEL

- Status: Completed
- Plan: -
- Owner: local-session
- Updated: 2026-06-11

## Goal

The request-completed access log line is written at a fixed `info` level for
every request, with no way to filter it independently of other info logs.
Add an `HTTP_LOG_LEVEL` env config (`debug | info | silent`, default `info`)
controlling the level of successful (2xx/3xx) access lines. Failure responses
stay visible regardless: status >= 500 logs at `error`, status >= 400 at
`warn`. Also enrich the `unhandled error` log line in the global error
handler with `requestId`, `method`, and `path` so a user-reported
`X-Request-Id` can be matched to its stack trace.

## Scope

- `apps/api/src/config/schema.ts` — add `HTTP_LOG_LEVEL` field.
- `apps/api/src/shared/middleware/logging.ts` — status-based leveling +
  configured level for success lines.
- `apps/api/src/shared/middleware/error-handler.ts` — add request context to
  the unhandled-error log.
- `.env.example` — document the new variable.
- Focused tests in `logging.test.ts` and `error-handler.test.ts`.

Out of scope: logger core (`shared/lib/logger.ts`), metrics emission,
log file/rotation behavior, frontend.

## Acceptance

- `HTTP_LOG_LEVEL=silent` suppresses 2xx/3xx access lines; 4xx still logs at
  `warn` and 5xx at `error`.
- `HTTP_LOG_LEVEL=debug` writes 2xx/3xx lines at `debug` (hidden under the
  default `LOG_LEVEL=info`).
- Default behavior unchanged for `info` except 4xx/5xx now log at
  `warn`/`error` instead of `info`.
- `unhandled error` log carries `requestId`, `method`, `path`.
- Focused middleware tests pass; `bun run check` passes.

## Notes

- 2026-06-11 - Investigation: no existing env filter for access logs; only
  coarse `LOG_LEVEL`. Error-handler logs unhandled errors without request
  context. Proposal approved by user.
- 2026-06-11 - Implemented: `HTTP_LOG_LEVEL` schema field, status-based
  leveling in `loggingMiddleware(httpLogLevel)`, request context on the
  unhandled-error log, `.env.example` + regenerated env-reference. Also
  added `HTTP_LOG_LEVEL: "info"` to the full-`Config` fixture in
  `auth.routes.test.ts` (typecheck). Focused tests 16/16; `bun run check`
  EXIT 0 (api 1801 / web 510, all gates green).
