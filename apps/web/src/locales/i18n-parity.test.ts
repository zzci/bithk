// Locale parity guard. Complements `scripts/check-i18n.ts` (key-set,
// interpolation-token and code->locale checks that already run under
// `bun run check`) with the one surface that script does NOT cover: leaf
// values that are byte-identical ASCII between locales — the strongest
// "someone forgot to translate" signal (audit lane 06, finding F4). A
// missing translation falls back silently to English (i18n.ts:127), so
// these never surface as runtime errors; this test turns them into a CI
// failure.
//
// Two assertions per run:
//   1. Key-set parity — every dot-path in one locale exists in the other,
//      per namespace. (Redundant with check-i18n.ts on purpose: defence in
//      depth, and it runs inside the Vitest phase.)
//   2. ASCII-identical values — every leaf whose value is identical and
//      pure-ASCII across locales must be in IDENTICAL_ALLOWLIST. The
//      allowlist holds values that are intentionally identical (acronyms,
//      numeric placeholders, example URLs). Any new identical value fails
//      the test, forcing either a real translation or a conscious allowlist
//      entry. This is the gate that would have caught F1.
//
// Locale shards are loaded with Vite's `import.meta.glob` (same mechanism as
// `i18n.ts`) so the test needs no Node type definitions in the web tsconfig.
import { describe, expect, it } from "vitest";

// Eagerly import every `<lang>/<namespace>.json` shard next to this file.
const shards = import.meta.glob<Record<string, unknown>>("./*/*.json", {
  eager: true,
  import: "default",
});

const RE_SHARD = /^\.\/([^/]+)\/([^/]+)\.json$/;
const REFERENCE = "en";

// `${namespace}:${dot.path}` for every leaf that is intentionally identical
// across locales and pure-ASCII (so the ASCII-identical heuristic would flag
// it). Keep this list small and reviewed — adding to it is a deliberate act.
const IDENTICAL_ALLOWLIST: ReadonlySet<string> = new Set([
  "ships:field.mmsi", // MMSI — maritime acronym, identical in every locale
  "projects:list.moreTags", // "+{{count}}" — symbol + interpolation, no words
  "totp:verifyCodePlaceholder", // "000000" — numeric input placeholder
  "contacts:share.targetId", // "ID" — acronym
  "editor:linkDialogPlaceholder", // "https://example.com" — example URL
  "settings:tabs.smtp", // SMTP — protocol acronym
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flatten(value: unknown, prefix = "", out: Map<string, string> = new Map()): Map<string, string> {
  if (typeof value === "string") {
    out.set(prefix, value);
    return out;
  }
  if (!isObject(value))
    return out;
  for (const [k, v] of Object.entries(value)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

// languages -> namespace -> flattened leaves.
const locales = new Map<string, Map<string, Map<string, string>>>();
for (const [key, mod] of Object.entries(shards)) {
  const m = RE_SHARD.exec(key);
  if (!m)
    continue;
  const [, lang, ns] = m;
  if (!locales.has(lang!))
    locales.set(lang!, new Map());
  locales.get(lang!)!.set(ns!, flatten(mod));
}

const languages = [...locales.keys()].sort();
const others = languages.filter(l => l !== REFERENCE);
const namespaces = [...(locales.get(REFERENCE)?.keys() ?? [])].sort();

function leaves(lang: string, ns: string): Map<string, string> {
  return locales.get(lang)?.get(ns) ?? new Map();
}

// Pure-ASCII and non-empty: Chinese characters are > U+007F, so a value that
// is all-ASCII and equal across locales is almost certainly untranslated.
function isAsciiIdentityCandidate(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return value.length > 0 && /^[\x00-\x7F]*$/.test(value);
}

describe("locale parity", () => {
  it("has at least the reference locale and one other to compare", () => {
    expect(languages).toContain(REFERENCE);
    expect(others.length).toBeGreaterThan(0);
    expect(namespaces.length).toBeGreaterThan(0);
  });

  describe.each(namespaces)("namespace %s", (ns) => {
    it.each(others)(`%s has the same key set as ${REFERENCE}`, (lang) => {
      const refLeaves = leaves(REFERENCE, ns);
      const otherLeaves = leaves(lang, ns);
      const missingInOther = [...refLeaves.keys()].filter(k => !otherLeaves.has(k));
      const missingInRef = [...otherLeaves.keys()].filter(k => !refLeaves.has(k));
      expect(
        { missingInOther, missingInRef },
        `key-set drift in ${ns} (${REFERENCE} <-> ${lang})`,
      ).toEqual({ missingInOther: [], missingInRef: [] });
    });
  });

  it("has no untranslated ASCII-identical values outside the allowlist", () => {
    const flagged: string[] = [];
    for (const ns of namespaces) {
      const refLeaves = leaves(REFERENCE, ns);
      for (const lang of others) {
        const otherLeaves = leaves(lang, ns);
        for (const [path, value] of refLeaves) {
          const other = otherLeaves.get(path);
          if (other !== undefined && other === value && isAsciiIdentityCandidate(value)) {
            flagged.push(`${ns}:${path}`);
          }
        }
      }
    }
    const unexpected = [...new Set(flagged)].filter(id => !IDENTICAL_ALLOWLIST.has(id)).sort();
    expect(
      unexpected,
      "ASCII-identical (likely untranslated) values found. Translate them, "
      + "or if they are intentionally identical add them to IDENTICAL_ALLOWLIST.",
    ).toEqual([]);
  });
});
