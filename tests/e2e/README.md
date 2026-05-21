# API e2e suite (live API + dex IdP)

Drives the live API process against a real OIDC provider (dex) over a real
SQLite database (`bun:sqlite`). The test data dir lives under
`tests/e2e/.cache/data/` (per-run subdir) so it never collides with the
local dev DB at `<repo>/data/db/app.db`.

## Run

```bash
bun run test:e2e
```

The orchestrator prints a phase-by-phase summary at the end, e.g.:

```
e2e summary
  phase                                 tests   pass   fail   skip     time
  modules                                  46     46      0      0    2.74s
  TOTAL                                    46     46      0      0    2.74s
```

## Reports

Each run writes JUnit XML and a JSON summary into
`tests/e2e/.cache/reports/<run-ts>/`:

```
tests/e2e/.cache/reports/<run-ts>/
  modules.xml
  summary.json
```

A `tests/e2e/.cache/reports/latest` symlink always points to the most
recent run, so CI can attach `tests/e2e/.cache/reports/latest/*.xml` as
test artefacts unconditionally. The orchestrator keeps the 10 most
recent runs and trims older ones.

The orchestrator runs a single phase:

| Phase | Test target | What it covers |
|---|---|---|
| **modules** | every `modules/<name>/*.test.ts` | Real-user simulation against the dex-wired API: OAuth login, profile, users / groups CRUD, TOTP enrol + step-up, policy tuples + check + resource-groups, issues + comments + attachments, documents + folders + sharing + attachments, settings, audit, backup export + restore, cron catalog and CRUD. |

dex itself is fetched on first run (binary extracted from the official
`ghcr.io/dexidp/dex` OCI image — no docker daemon required, just curl +
python3 + tar) into `tests/e2e/.cache/dex` and reused.

The first OIDC login as `admin@example.com` auto-promotes that user to
admin via `DEFAULT_ADMIN` — no separate bootstrap step is needed.

## Layout

```
tests/e2e/
  run.ts                       # orchestrator (entry point)
  scripts/install-dex.sh       # ghcr-pull-then-source-build dex installer
  dex/config.yaml              # static client + 2 static users
  lib/
    api.ts                     # cookie-jar HTTP client (multipart-aware)
    oidc.ts                    # OIDC login walker + per-email session cache
  modules/
    system/
      health.test.ts
      security.test.ts         # CSRF + Origin guard cases
    account/
      auth.test.ts             # OIDC login + me + logout
      me.test.ts               # /me / users / preferences / status update
      groups.test.ts           # CRUD + members
      totp.test.ts             # enrol + confirm + step-up + delete
      single-user.test.ts      # single-user mode (OAuth bypass)
    policy/
      tuples.test.ts           # tuple CRUD + check
      resource-groups.test.ts  # rg CRUD + check chain (editor implies viewer)
    document/
      documents.test.ts        # folders + documents + sharing
      attachments.test.ts      # multipart upload + download + delete
    issue/
      issues.test.ts           # CRUD + comments
      attachments.test.ts      # multipart upload + size cap
    settings/
      settings.test.ts         # admin K/V + 403 matrix
    audit/
      audit.test.ts            # event listing + 403 matrix
    backup/
      export.test.ts           # admin export
      restore.test.ts          # export → import round-trip
    cron/
      cron.test.ts             # actions catalog + CRUD + pause/resume/trigger
  .cache/                      # dex binary + per-run data dirs (gitignored)
```

## Static users (dex)

Both have password `admin`:

| Email | Role in API |
|---|---|
| `admin@example.com` | admin (matches `DEFAULT_ADMIN`) |
| `user@example.com` | regular user |

## Adding a new test

1. Drop `<area>.test.ts` under the matching `modules/<module>/` folder.
2. Use `getClient(email)` from `../../lib/oidc` to grab a cached, logged-in
   `ApiClient`. The cache self-heals (probes `/me`, re-logs in on 401).
3. The orchestrator wires `E2E_API_BASE` and `E2E_DEX_BASE` into the test
   process — `lib/api.ts` reads `E2E_API_BASE` so tests work whether the
   API is on the default `:3010` or somewhere else.
4. New module subdirs have to be added to `MODULE_DIRS` in `run.ts` so the
   orchestrator picks them up.
