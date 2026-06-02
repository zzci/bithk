# Architecture & Type-Safety Audit

**Dimension:** cross-cutting architecture & type-safety
**Campaign:** `l1-w6c655lo-audit-20260602135842` (AUDIT-ONLY — no code changes)
**Scope:** `packages/*` boundaries, env/config + build pipeline, type-safety hotspots (`any` / `as` / `@ts-ignore` / non-null `!`), circular dependencies, root config consistency.

## Methods

- **madge** (`bunx madge --circular`) for cycle detection — run twice per app: bare (relative-only) and with `--ts-config` so `@/*` path aliases resolve. Both apps: **no cycles**.
- **ripgrep** tallies for `: any` / `as any`, `as <Type>` casts, `as unknown as` double-casts, non-null `!`, `@ts-ignore`/`@ts-expect-error`/eslint-disable; hotspots ranked by file.
- **Manual read** of `packages/shared` exports vs. every consumer, all root/app/package configs (`package.json`, `tsconfig*`, `bunfig.toml`, `vite.config.ts`, `eslint.config.ts`), and the API module barrels.
- **context7** to verify `resolve.tsconfigPaths` is a real Vite 8 option before judging the build config (it is — avoided a false positive).

## Totals by severity

| Severity | Count |
|----------|-------|
| critical | 0 |
| high     | 2 |
| medium   | 5 |
| low      | 4 |
| **total**| **11** |

Plus a **Strengths** section documenting verified non-findings (cycles, `any`, tsconfig strictness, Vite config) so later passes don't re-litigate them.

---

## Area A — `packages/shared`: vestigial package boundary

The package exists to share two things between `api` and `web`: an `ApiResponse<T>` envelope type and ECIES crypto. **Neither export is imported by any consumer.** Verified by ripgrep for `from "@app/shared"` (0 source hits), every exported symbol name (`eciesEncrypt`, `generateKeyPair`, `bytesToHex`, `ApiResponse`, …), dynamic `import("…shared")` (0), and `@noble` usage (only inside the package itself).

- `apps/api/package.json:30` & `apps/web/package.json:21` — severity: **medium** — confidence: **high**
  - rationale: both apps declare `"@app/shared": "workspace:*"` but import nothing from it — phantom workspace dependency that drags an unused `@noble/secp256k1` runtime dep into the graph.
  - suggested action: either delete the `@app/shared` dependency from both apps (and the package, if the template no longer needs it), or actually consume its `ApiResponse`/crypto. (cross-ref: deps dimension)

- `packages/shared/src/ecies.ts:1` (whole module, 145 lines) + `packages/shared/package.json:22` — severity: **medium** — confidence: **high**
  - rationale: ECIES + `@noble/secp256k1` is dead from the apps' perspective — the API does its real encryption with `node:crypto` (`createCipheriv`/`aes-256-gcm`) in `apps/api/src/modules/account/auth/pkce-secret.ts:2`, never the shared ECIES. No static or dynamic import reaches it.
  - suggested action: remove the ECIES module + `@noble` dep, or wire it to the feature that was meant to use it. (cross-ref: deps / dead-code-api dimensions)

- `packages/shared/src/index.ts:1` (`ApiResponse<T>`) — severity: **low** — confidence: **high**
  - rationale: the one type the package was named for is superseded by a *different, stronger* local copy in `apps/api/src/shared/lib/api-response.ts:35` (a `ApiSuccess<T> | ApiError` discriminated union) and ignored by web (see B). Three definitions of "the response envelope" exist; the shared one is the only one nobody uses.
  - suggested action: pick one canonical envelope. If `@app/shared` is kept, move the api's discriminated-union version there and consume it from both apps.

---

## Area B — Type contract fragmentation: the API response envelope

- `apps/web/src/shared/lib/api/projects.ts:17` (+ 13 sibling files) — severity: **high** — confidence: **high**
  - method: ripgrep — 14 files under `apps/web/src/shared/lib/api/` each declare their own inline `ApiEnvelope<T>` / `ApiListEnvelope<T>` (identical shapes): `projects.ts`, `ships.ts`, `share.ts`, `documents.ts`, `drive.ts`, `search.ts`, `settings.ts`, `pins.ts`, `procurement.ts`, `tag-admin.ts`, `contacts.ts`, `contact-categories.ts`, `global-categories.ts`, `admin-default-cover.ts`.
  - rationale: the central client⇄server contract has 14 copy-pasted definitions, all using the weak `success: boolean` instead of a discriminated `success: true | false` — so TS can't narrow `data` vs `error` from `success`. A response-shape change touches 14 files. This is the single largest cross-cutting type-safety/architecture issue in web.
  - suggested action: define one `ApiEnvelope<T>` / `ApiListEnvelope<T>` (discriminated) in a single web `lib/api/types.ts` (or consume the canonical one from `@app/shared` per A), and import it everywhere.

---

## Area C — Type-safety: non-null assertion clusters in route handlers

- `apps/api/src/modules/document/document.routes.ts` (39 hits), `apps/api/src/modules/drive/drive.routes.ts` (29), `share.routes.ts` (10), `contact.routes.ts` (10), `account/users/users.routes.ts` (10), `policy.routes.ts` (9), `cron.routes.ts` (7) — severity: **medium** — confidence: **high**
  - method: ripgrep — ~200 non-null `!` in production code, overwhelmingly the same three call patterns: `c.get("user")!` (document.routes.ts:116/135/161/200/…), `c.req.param("id")!` (…:179/201/251/281), `policyContext(c)!` (…:103/217/290).
  - rationale: root cause is `apps/api/src/shared/lib/types.ts:17` — `user?: User` is optional in `AppEnv.Variables`, so every protected handler must `!`-assert it back to non-null. Each `!` silently bypasses strict-null checking; one mis-ordered middleware and these become runtime `undefined` accesses with no compile-time warning.
  - suggested action: give protected routes a typed sub-app whose `Variables.user` is non-optional (`Hono<ProtectedEnv>` mounted after the auth-required middleware), and a typed param helper, eliminating the bulk of the assertions.

---

## Area D — Type-safety: Drizzle write-result double-casts

- `apps/api/src/modules/document/document.service.ts:259`, `item/item.service.ts:151` & `:180`, `project/project.service.ts:448` `:486` `:799`, `contact/contact.service.ts:279`, `contact-category.service.ts:85`, `project/project.categories.ts:89`, `project/project.global-categories.ts:85`, `audit/retention.ts:35` — severity: **medium** — confidence: **high**
  - method: ripgrep `as unknown as` (production only).
  - rationale: the same `… .run() as unknown as RunResult` / `as unknown as { changes: number }` workaround is repeated across ~11 service files to read `.changes` off a Drizzle write the types don't expose. `as unknown as` is the strongest possible escape hatch — it erases *all* checking at each call site, and the pattern is duplicated rather than centralized.
  - suggested action: add one typed helper (e.g. `runWrite(stmt): RunResult`) in the db layer and call it everywhere, confining the unsafe cast to a single audited location.

---

## Area E — Module boundary discipline: barrels bypassed

- `apps/api/src/modules/audit/index.ts:1` (representative) — severity: **medium** — confidence: **medium**
  - method: ripgrep — all 19 API modules have an `index.ts` barrel, but cross-module imports (242 `@/modules/*` import lines) overwhelmingly reach *past* the barrel into internals: `@/modules/audit/audit.service` ×18, `@/modules/project/project.service` ×10, `@/modules/item/item.service` ×4, `@/modules/policy/zanzibar.engine` ×6, plus widespread `@/modules/*/schema` deep imports.
  - rationale: the barrels expose a curated public surface (e.g. `audit/index.ts` exports only `auditRoutes` + retention lifecycle — *not* `audit.service`), yet consumers import the service directly. The encapsulation the barrels imply is not actually enforced, so any module can couple to any other module's internals.
  - suggested action: decide the boundary policy and enforce it — either (a) export the genuinely-public surface from each barrel and forbid deep cross-module imports via `eslint no-restricted-imports` / `import/no-internal-modules`, or (b) accept deep imports and drop the half-applied barrels. Note `schema` deep-imports are often legitimate (Drizzle relations) and can be whitelisted.

---

## Area F — Minor config / consistency observations

- `apps/api/package.json:14` (`"exports": { ".": "./src/dev.ts" }`) — severity: **low** — confidence: **medium**
  - rationale: the package's public main resolves to a *dev-only* entry (`dev.ts`), not `index.ts`. It works (used for in-process dev import), but advertising a dev entry as the package surface is surprising and could mislead a `import "@app/api"` consumer.
  - suggested action: point `exports["."]` at a stable entry, or document why `dev.ts` is the intended surface.

- `tsconfig.json:1` (root) — severity: **low** — confidence: **high**
  - rationale: root `tsconfig.json` only `extends` the base and declares no `include`/`files`/`references`; a bare `tsc` at root type-checks nothing. Typecheck relies entirely on per-workspace `tsc --noEmit` via `bun run --filter '*' typecheck`. Harmless but means the root config is editor-defaults only, not a project graph.
  - suggested action: optionally add `references` to the workspace tsconfigs for a coherent `tsc -b`, or leave as-is and note it.

- `apps/api/src/modules/policy/permission.ts:176` (and `:180`,`:205`,`:209`,`:251`) — severity: **low** — confidence: **high**
  - rationale: generic field-filtering uses `out[k as keyof TRow] = v as TRow[keyof TRow]` because `Object.entries` widens keys to `string`. Localized and idiomatic for TS, but a cluster of assertions in one security-relevant path (field-level permission filtering) — worth a targeted unit test rather than a refactor.
  - suggested action: keep, but cover `filterReadable`/`filterWritable` with tests that assert restricted fields are actually dropped.

- `apps/web/src/shared/lib/logger`… N/A — `apps/api/src/shared/lib/logger.ts:102` & `:234` (`as unknown as`) — severity: **low** — confidence: **high**
  - rationale: two more double-casts outside the Drizzle cluster (pino proxy + reopenable dest). Justified by external lib typings; noted for completeness, not action.

---

## Strengths (verified non-findings — do not re-flag)

- **No circular dependencies.** `bunx madge --circular --ts-config <app tsconfig>` on both `apps/api/src` (305 files) and `apps/web/src` (369 files) reports zero cycles *with* `@/*` alias resolution. (residual madge "warnings" are unresolved node/bun builtins, not cycles.)
- **`any` is genuinely banned.** `eslint.config.ts:13` sets `ts/no-explicit-any: error`; ripgrep finds **zero** `: any` / `as any` in production code (only the words inside comments).
- **No suppression debt.** No `@ts-ignore` / `@ts-expect-error` anywhere except the generated `apps/web/src/app/routeTree.gen.ts` (`@ts-nocheck`, expected). eslint-disables are localized and justified (react-refresh on route files, `set-state-in-effect` for form seeding).
- **Strong tsconfig baseline.** `packages/tsconfig/base.json` enables `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules` — a notably strict, modern config inherited consistently by all workspaces.
- **`catalog:` used for shared dep pinning** (`typescript`, `vitest`) across `api`/`web`/`shared` — consistent version management.
- **Vite build config is correct.** `apps/web/vite.config.ts:30` `resolve: { tsconfigPaths: true }` is a *native Vite 8 feature* (built-in tsconfig-paths support, verified via Vite docs) — not a missing-plugin bug. `base`-path handling mirrors the API config intentionally.
