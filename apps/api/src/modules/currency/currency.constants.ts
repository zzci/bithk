// Built-in currency codes offered everywhere a currency is picked (procurement,
// HR salary/payroll). Admins extend this list with custom codes stored under the
// `app.currencies` setting; the two are merged by `getCurrencyConfig`. The list
// is intentionally a curated set of common codes — the backend still accepts any
// 3-letter uppercase code, so legacy values stay valid even when not listed.
export const BUILTIN_CURRENCIES: readonly string[] = [
  "CNY",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "HKD",
  "SGD",
  "THB",
];

// Settings key holding the admin-added custom currency codes (a JSON array of
// strings), written through the generic admin settings CRUD.
export const CURRENCIES_SETTING_KEY = "app.currencies";
