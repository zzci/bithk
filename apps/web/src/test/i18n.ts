// A synchronous i18n instance for tests. Unlike the app instance (which
// lazy-loads each namespace as a Vite chunk), tests need translations resolved
// before the first render so assertions match real copy, not raw keys. We
// eagerly import every English namespace shard and seed `resources` up front.
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

const modules = import.meta.glob<{ default: Record<string, unknown> }>(
  "../locales/en/*.json",
  { eager: true },
);

const RE_NS = /\/([^/]+)\.json$/;

const resources: Record<string, Record<string, unknown>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const ns = RE_NS.exec(path)?.[1];
  if (ns)
    resources[ns] = mod.default;
}

const namespaces = Object.keys(resources);

const testI18n = createInstance();
void testI18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  fallbackNS: "common",
  ns: namespaces,
  resources: { en: resources },
  react: { useSuspense: false },
  interpolation: { escapeValue: false },
});

export default testI18n;
