# PLAN-094 Global currency list referenced by procurement & HR (+ THB)

- **status**: completed
- **createdAt**: 2026-06-20 00:00
- **approvedAt**: 2026-06-20 00:00
- **relatedTask**: FEAT-042

## Context

Currency is fragmented across the app:

- Procurement detail has a free-text `currency` column; the form
  (`-project-procurement-form.tsx`) edits it via a plain `<Input maxLength={10}>`.
- HR colleague `salaryCurrency` and payroll `currency` (validated `^[A-Z]{3}$`)
  use a hard-coded web list `HR_PAYROLL_CURRENCIES` (`hr-payroll.ts`) =
  `[CNY, USD, EUR, GBP, JPY, HKD, SGD]` — no THB.
- The seeded `procurement.default_currency = "USD"` has **zero consumers** (dead).
- The admin settings page has no currency management; the generic `/settings/:key`
  CRUD is admin-only, so it cannot back a list read by ordinary users.
- The admin settings page has a standalone "Contact" tab whose sole content is
  `ContactCategoriesSection`.

## Proposal

### Backend — a non-admin currency endpoint

New small module `apps/api/src/modules/currency`:

- `currency.constants.ts`: `BUILTIN_CURRENCIES = [CNY, USD, EUR, GBP, JPY, HKD,
  SGD, THB]`.
- `currency.service.ts`: `getCurrencyConfig(db)` → `{ builtin, custom }`. `custom`
  is parsed from the existing settings key `app.currencies` (a JSON array of
  codes); invalid/missing → `[]`.
- `currency.routes.ts`: `GET /currencies` guarded by `authRequired` only (not
  admin) so procurement/HR forms can read it; `describeRoute` documents the
  `{ builtin, custom }` payload.
- `index.ts`: export `currencyRoutes`.
- Mount in `routes/protected.ts`; add `/currencies` to `UNGATED_PREFIXES`
  (cross-cutting, every authenticated user needs it) so the route-coverage test
  passes.

Custom currencies are written through the existing admin `PUT /settings/app.currencies`
(JSON array) — no new write route, no new table, no migration.

### Frontend — shared data layer

`apps/web/src/shared/lib/api/currency.ts`:

- `useCurrencies()` → query `GET /currencies` (`{ builtin, custom }`).
- `useGlobalCurrencies()` → memoised merged `builtin ∪ custom`.
- `withCurrency(list, value)` → list unioned with a record's own value (keeps a
  legacy code selectable).
- `isValidCurrencyCode(code)` → `^[A-Z]{3}$`.
- `useSaveCustomCurrencies()` → PUT `app.currencies` and invalidate the
  currency query.

### Frontend — global settings tab

- New `-settings-currency.tsx` `CurrencySettingsSection`: built-in codes shown
  read-only (badges); custom codes listed with remove; an add input
  (uppercased, validated 3-letter, dedup vs the whole list).
- New `-settings-general.tsx` `GeneralSettingsTab` composing
  `CurrencySettingsSection` + `ContactCategoriesSection`.
- `-settings-contact.tsx`: export `ContactCategoriesSection`, drop the
  `ContactSettingsTab` wrapper.
- `settings.lazy.tsx`: remove the Contact tab; add a General tab.

### Frontend — consumers reference the global list

- Procurement form: replace the free-text currency `<Input>` with a `Select`
  whose options are `withCurrency(useGlobalCurrencies(), form.currency)`; a
  "none" option keeps it optional (maps to `""`).
- HR colleague panel: salary currency `EnumField` options become
  `withCurrency(useGlobalCurrencies(), form.salaryCurrency || null)`.
- HR payroll page: create-record currency `Select` options become
  `withCurrency(useGlobalCurrencies(), record?.currency)`.
- Remove `HR_PAYROLL_CURRENCIES` + its test assertion.

### i18n + seed

- `settings.json` (en/zh): add `tabs.general`, remove `tabs.contact`; add a
  `currency.*` block.
- seed `settings.json`: remove the dead `procurement.default_currency`.

## Risks

- Low. No backend `currency` column / validation change → old 3-letter codes and
  legacy records stay valid and selectable, displayed as-is.
- `GET /currencies` must be allowlisted in `UNGATED_PREFIXES` or the
  route-coverage test fails (handled).
- New route ⇒ regenerate api-docs + api-spec, else `check:api-docs/spec` fail.

## Scope

~5 backend files (1 small module + protected.ts + UNGATED list) + 1 backend
test; ~7 web files (1 api layer, 2 new settings sections, settings.lazy,
procurement form, 2 HR files) + test updates; 2 i18n files; seed; regenerated
api-docs/spec; changelog. No migration.

## Alternatives

- A dedicated `currencies` table with admin CRUD — rejected: a currency is just
  a code; a settings-backed JSON list avoids a table + migration + routes.
- Reading the list via the generic settings endpoint — rejected: it is
  admin-only, so ordinary users (the form audience) could not read it.
- Forcing THB as the global default currency — rejected per the user: THB is
  added to the list, not made the default; the field stays optional.

## Annotations

- 2026-06-20: Proposal iterated with the user — global is an *extensible list*
  (not a single default value); built-ins kept + THB added; HR list promoted to
  global and unioned with each record's own currency; currency lives in a new
  global settings tab alongside the moved Contact Categories; backward compatible
  with legacy 3-letter codes. Approved with "然后开始处理".
