// Currency data layer. The available currency list (built-in codes + admin-added
// custom codes) is served by the non-admin `GET /currencies` endpoint so the
// procurement and HR forms can offer it. Custom codes are persisted through the
// admin-only generic settings CRUD under `app.currencies` (a JSON array string).

import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { http } from "../http";

export const CURRENCIES_SETTING_KEY = "app.currencies";

export interface CurrencyConfig {
  readonly builtin: readonly string[];
  readonly custom: readonly string[];
}

export const currencyKeys = {
  all: ["currencies"] as const,
};

export function useCurrencies() {
  return useQuery<CurrencyConfig>({
    queryKey: currencyKeys.all,
    queryFn: async () => {
      const res = await http<ApiEnvelope<CurrencyConfig>>("/currencies");
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}

function dedupe(list: readonly string[]): string[] {
  return [...new Set(list)];
}

// Merged built-in ∪ custom list (built-ins first), memoised for stable options.
export function useGlobalCurrencies(): string[] {
  const { data } = useCurrencies();
  return useMemo(
    () => dedupe([...(data?.builtin ?? []), ...(data?.custom ?? [])]),
    [data],
  );
}

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

export function isValidCurrencyCode(code: string): boolean {
  return CURRENCY_CODE_RE.test(code);
}

// Ensure a record's own (possibly legacy) currency stays selectable even when it
// is not part of the configured global list — backward compatibility for codes
// that predate the global list.
export function withCurrency(list: readonly string[], value: string | null | undefined): string[] {
  return value ? dedupe([...list, value]) : [...list];
}

// Persist the admin-managed custom list, then refresh the public currency query
// so every consumer picks up the change.
export function useSaveCustomCurrencies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (codes: readonly string[]) =>
      http<ApiEnvelope<null>>(`/settings/${encodeURIComponent(CURRENCIES_SETTING_KEY)}`, {
        method: "PUT",
        body: JSON.stringify({ value: JSON.stringify(codes) }),
      }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: currencyKeys.all });
    },
  });
}
