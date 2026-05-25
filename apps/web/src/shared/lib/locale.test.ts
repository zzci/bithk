import { describe, expect, it, vi } from "vitest";
import { toIntlLocale } from "./locale";

vi.mock("@/app/i18n", () => ({
  default: {
    language: "en-US@posix",
    resolvedLanguage: "en",
  },
}));

describe("toIntlLocale", () => {
  it("strips POSIX modifiers", () => {
    expect(toIntlLocale("en-US@posix")).toBe("en-US");
  });

  it("converts underscore separators", () => {
    expect(toIntlLocale("zh_CN")).toBe("zh-CN");
  });

  it("falls back for unusable tags", () => {
    expect(toIntlLocale("garbage", "zh_CN")).toBe("zh-CN");
  });
});

describe("formatDate", () => {
  it("does not throw when i18n.language is POSIX-style", async () => {
    const { formatDate } = await import("./format");

    expect(() => formatDate("2026-05-25T00:00:00.000Z")).not.toThrow();
  });
});
