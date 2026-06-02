import { afterAll, describe, expect, it } from "vitest";

import i18n, { i18nReady } from "@/app/i18n";
import { formatDate } from "@/shared/lib/format";
import { toIntlLocale } from "@/shared/lib/locale";
import { formatLongDate, formatShortDate } from "./-documents-shared";

const ISO = "2026-06-02T08:30:00.000Z";

function shortFor(locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(ISO));
}

await i18nReady;

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("formatShortDate", () => {
  it("formats month/day off the active locale (en), not a hardcoded CJK string", async () => {
    await i18n.changeLanguage("en");
    const out = formatShortDate(ISO);
    expect(out).toBe(shortFor(toIntlLocale("en")));
    expect(out).not.toContain("月");
    expect(out).not.toContain("日");
  });

  it("switches to the active locale (zh) via Intl", async () => {
    await i18n.changeLanguage("zh");
    expect(formatShortDate(ISO)).toBe(shortFor(toIntlLocale("zh")));
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatShortDate("not-a-date")).toBe("");
  });
});

describe("formatLongDate", () => {
  it("delegates to the shared locale-aware helper", async () => {
    await i18n.changeLanguage("en");
    expect(formatLongDate(ISO)).toBe(formatDate(ISO));
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatLongDate("not-a-date")).toBe("");
  });
});
