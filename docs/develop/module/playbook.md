# Module Playbook

A numbered, copy-the-shape checklist for adding a new business module. Keep this open while wiring things up; jump to [`standards.md`](standards.md) for the **why** behind each rule and to [`recipe.md`](recipe.md) for ready-to-paste starter files.

Replace `<name>` with your module's kebab-case singular name (e.g. `ticket`).

1. **Create the backend four-file set** under `apps/api/src/modules/<name>/`: `schema.ts`, `<name>.service.ts`, `<name>.routes.ts`, `index.ts`.
   - Tables live in `schema.ts`; the service consumes `c.get("db")`; routes wrap `authRequired`; `index.ts` only re-exports.
   - Why: [§2.1 File layout](standards.md#21-file-layout), [§2.6 Schema sharding](standards.md#26-schema-sharding-mandatory).

2. **Re-export the schema** from `apps/api/src/db/schema.ts` (one line, alphabetical):
   ```ts
   export * from "@/modules/<name>/schema";
   ```
   Why: drizzle-kit walks this file when generating migrations. See [§2.6](standards.md#26-schema-sharding-mandatory).

3. **Mount the routes** in `apps/api/src/routes/protected.ts` (one import + one `app.route` line):
   ```ts
   import { <name>Routes } from "@/modules/<name>";
   app.route("/", <name>Routes());
   ```
   Use `public.ts` only when the route must work without a session. Why: [§2.4 Route mounting](standards.md#24-route-mounting).

4. **Claim your route prefixes in the two path→module registries.** Mounting alone is not enough — every top-level prefix your routes own must be claimed in both:
   - `apps/api/src/shared/modules.ts` (`MODULES`) — the nav-module visibility gate — **or**, for admin-only / cross-cutting surfaces that must stay outside role gating, the `UNGATED_PREFIXES` allowlist in `apps/api/src/modules/account/groups/module-gate.ts`. Test-enforced: `module-gate.test.ts` fails if a mounted prefix is neither claimed by exactly one module nor explicitly ungated.
   - `apps/api/src/modules/account/tokens/scope.ts` (`TOKEN_MODULES`) — the Personal Access Token scope map (first match wins). Test-enforced: `scope.test.ts` ("protected router scope coverage") fails if a mounted protected prefix is not claimed by exactly one token module.

   Both lockstep tests run in `bun run check`, so a forgotten entry fails the gate rather than shipping. The generated route index / OpenAPI spec need **no** registry edit: `apps/api/scripts/lib/route-table.ts` composes the real `publicRoutes()`/`protectedRoutes()` factories, so `gen:api-docs` / `gen:api-spec` pick up your mounts automatically — just regenerate (step 11 runs the checks). After regenerating the spec, run `bun run gen:api-types` to refresh the committed web types (`apps/web/src/shared/lib/api/_generated/api-types.ts`, drift-gated by `check:api-types`).

5. **(Optional) Register a policy relation** in `apps/api/src/modules/policy/namespace-config.ts` only if the seven `item` relations (`owner / editor / viewer / assignee / approver / watcher / parent_item`) are insufficient. Add one entry inside the existing namespace's `relations` block — do not create a new namespace lightly. Why: [§0 Content modules](standards.md#0-content-modules-build-on-item--file).

6. **Register a backup contribution** if the module owns persistent tables. Create `<name>.backup.ts` exporting a `BackupContribution`, then in `index.ts`:
   ```ts
   import { registerBackupContribution } from "@/modules/backup/registry";
   import { <name>BackupContribution } from "./<name>.backup";
   registerBackupContribution(<name>BackupContribution);
   ```
   The import in `protected.ts` (step 3) triggers this side effect. Why: [§2.8 Backup contribution](standards.md#28-backup-contribution-mandatory-for-modules-that-own-tables).

7. **Add the sidebar nav item.** Create `apps/web/src/app/routes/_app/<area>/-<name>.nav.ts` exporting a `NavItem`, then add one import + one array entry to `apps/web/src/shared/components/sidebar/registry.ts`. Why: [§3.3 Sidebar](standards.md#33-sidebar) and the "core principle" aggregate-file table.

8. **Add the i18n shard.** Drop `apps/web/src/locales/en/<name>.json` and `apps/web/src/locales/zh/<name>.json`; both must carry the same key set. The namespace list is derived automatically from the file system, so no edit to `i18n.ts` is needed. Use `useTranslation("<name>")` in components. Why: [§3.4 i18n sharding](standards.md#34-i18n-sharding-mandatory).

9. **Add tests.** Unit: `apps/api/src/modules/<name>/<name>.test.ts` (uses a temp SQLite per test). E2E: create `tests/e2e/modules/<name>/` with at least one `*.test.ts` per top-level resource, then append `"<name>"` to `MODULE_DIRS` in `tests/e2e/run.ts`. Why: [§5.0 Coverage philosophy](standards.md#50-coverage-philosophy-read-this-first) and [§5.3 e2e](standards.md#53-end-to-end-e2e--owns-the-user-facing-100).

10. **Write the module doc** `docs/modules/<name>.md` (file layout, database, routes, auditing, end-to-end coverage, out-of-scope) and add one row to `docs/architecture.md` / `docs/reference/api.md` / `docs/reference/database.md`. Why: [§4 Documentation sync](standards.md#4-documentation-sync).

11. **Generate the migration and run the gate.**
    ```bash
    bun run --filter @app/api db:generate   # commit drizzle/<n>_*.sql + meta/_journal.json
    bun run check                            # lint + typecheck + test + build + check:i18n + check:env-docs + check:api-docs
    ```
    All seven steps in `bun run check` must be green before opening the PR. Why: [§6 Quality gate](standards.md#6-quality-gate), [§8 Pre-merge checklist](standards.md#8-pre-merge-acceptance-checklist).
