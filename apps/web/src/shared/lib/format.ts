// Locale-aware date formatting. Drives output off the active i18n language
// instead of the browser locale, so a zh-CN user with navigator.language=en
// still sees Chinese dates.

import i18n from "@/app/i18n";
import { toIntlLocale } from "@/shared/lib/locale";

function lang(): string {
  return toIntlLocale(i18n?.language, i18n?.resolvedLanguage || "en");
}

export function formatDate(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime()))
    return "";
  return new Intl.DateTimeFormat(lang(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime()))
    return "";
  return new Intl.DateTimeFormat(lang(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// Money is stored as integers in a currency's minor unit (e.g. cents). These
// helpers convert between that minor-unit integer and the major-unit,
// two-decimal representation shown to and entered by users. Locale-aware
// grouping follows the active i18n language like the dates above.
export function formatMoney(minor: number): string {
  return new Intl.NumberFormat(lang(), {
    useGrouping: true,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

// Parse a major-unit string ("1234.56") into a minor-unit integer (123456),
// or null when blank, non-numeric, or negative.
export function parseMoneyToMinor(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "")
    return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0)
    return null;
  return Math.round(value * 100);
}

// Render a minor-unit integer as an editable major-unit string ("1234.56").
export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

// Human-readable byte size (B/KB/MB/GB/TB), one decimal below 10 units.
export function formatBytes(value: number): string {
  if (value < 1024)
    return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let next = value / 1024;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next.toFixed(next >= 10 ? 0 : 1)} ${units[index]}`;
}
