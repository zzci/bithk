import type { i18n as I18n, Resource } from "i18next";
import { act, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";

// Eagerly load every namespace shard for BOTH shipped locales so language
// switching resolves real copy synchronously (the app instance lazy-loads per
// chunk; tests need the strings up front to assert rendered text).
const modules = import.meta.glob<{ default: Record<string, unknown> }>(
  "../../locales/*/*.json",
  { eager: true },
);
const RE_KEY = /\/locales\/([^/]+)\/([^/]+)\.json$/;

function buildResources(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [path, mod] of Object.entries(modules)) {
    const m = RE_KEY.exec(path);
    if (!m)
      continue;
    const [, lng, ns] = m;
    (out[lng!] ??= {})[ns!] = mod.default;
  }
  return out;
}

function makeI18n(lng: string, resources: Record<string, Record<string, unknown>>): I18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng,
    fallbackLng: "en",
    defaultNS: "common",
    fallbackNS: "common",
    resources: resources as Resource,
    react: { useSuspense: false },
    interpolation: { escapeValue: false },
  });
  return instance;
}

function Probe() {
  const { t } = useTranslation(["common", "overview"]);
  return (
    <div>
      <span data-testid="nav">{t("common:nav.overview")}</span>
      <span data-testid="welcome">{t("overview:welcome", { name: "Sam" })}</span>
    </div>
  );
}

describe("i18n locale switching", () => {
  it("renders English copy and switches every string to Chinese on language change", async () => {
    const i18n = makeI18n("en", buildResources());
    render(<I18nextProvider i18n={i18n}><Probe /></I18nextProvider>);

    expect(screen.getByTestId("nav")).toHaveTextContent("Overview");
    expect(screen.getByTestId("welcome")).toHaveTextContent("Welcome, Sam");

    await act(async () => {
      await i18n.changeLanguage("zh");
    });

    expect(screen.getByTestId("nav")).toHaveTextContent("概览");
    expect(screen.getByTestId("welcome")).toHaveTextContent("欢迎回来，Sam");
  });

  it("renders the same representative keys for both locales without leaking raw keys", () => {
    const resources = buildResources();
    for (const lng of ["en", "zh"]) {
      const i18n = makeI18n(lng, resources);
      const { unmount } = render(<I18nextProvider i18n={i18n}><Probe /></I18nextProvider>);
      const nav = screen.getByTestId("nav").textContent ?? "";
      expect(nav).not.toBe("");
      // A missing key would surface the raw "common:nav.overview" string.
      expect(nav).not.toContain("nav.overview");
      unmount();
    }
  });

  it("falls back to English when a key is missing in the active locale", () => {
    const resources = {
      en: { common: { onlyEn: "English only" } },
      zh: { common: { other: "其他" } },
    };
    const i18n = makeI18n("zh", resources);
    render(<I18nextProvider i18n={i18n}><FallbackProbe /></I18nextProvider>);
    // `onlyEn` is absent from zh; it must resolve via the en fallback, not
    // render as the raw key.
    expect(screen.getByTestId("fb")).toHaveTextContent("English only");
  });
});

function FallbackProbe() {
  const { t } = useTranslation(["common"]);
  return <span data-testid="fb">{t("common:onlyEn")}</span>;
}
