import type { AppDatabase } from "@/db";
import { getSetting } from "@/modules/settings/settings.service";
import { BUILTIN_CURRENCIES, CURRENCIES_SETTING_KEY } from "./currency.constants";

export interface CurrencyConfig {
  readonly builtin: readonly string[];
  readonly custom: readonly string[];
}

// Parse the stored `app.currencies` value (a JSON array of codes) into a clean
// string list, dropping anything that is not a string. Any parse error or
// non-array shape degrades to an empty custom list rather than failing the read.
function parseCustomCurrencies(raw: string | null): string[] {
  if (!raw)
    return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed))
      return [];
    return parsed.filter((c): c is string => typeof c === "string");
  }
  catch {
    return [];
  }
}

// Resolve the currency list visible to any authenticated user: the built-in
// codes plus the admin-configured custom codes (deduplicated against built-ins).
export async function getCurrencyConfig(db: AppDatabase): Promise<CurrencyConfig> {
  const raw = await getSetting(db, CURRENCIES_SETTING_KEY);
  const builtinSet = new Set(BUILTIN_CURRENCIES);
  const custom = [...new Set(parseCustomCurrencies(raw))].filter(code => !builtinSet.has(code));
  return { builtin: BUILTIN_CURRENCIES, custom };
}
