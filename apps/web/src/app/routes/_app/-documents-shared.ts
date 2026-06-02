// Shared types and date helpers for the documents page.

import i18n from "@/app/i18n";
import { formatDate } from "@/shared/lib/format";
import { toIntlLocale } from "@/shared/lib/locale";

export interface DraftState {
  readonly title: string;
  readonly content: string;
  readonly tags: readonly string[];
}

export const EMPTY_DRAFT: DraftState = { title: "", content: "", tags: [] };

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()))
    return "";
  // Compact month/day to fit the narrow sidebar column, formatted off the
  // active i18n locale (zh → "6月2日", en → "Jun 2") instead of a
  // hardcoded CJK string.
  const locale = toIntlLocale(i18n?.language, i18n?.resolvedLanguage || "en");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(d);
}

export function formatLongDate(iso: string): string {
  // Full date via the shared locale-aware helper.
  return formatDate(iso);
}
