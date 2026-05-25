const FALLBACK_LOCALE = "en";

function normalizeTag(tag: string): string {
  return tag.trim().split("@", 1)[0]!.replaceAll("_", "-");
}

function canonicalLocale(tag: string): string | undefined {
  const normalized = normalizeTag(tag);
  if (!normalized)
    return undefined;

  try {
    const [canonical] = Intl.getCanonicalLocales(normalized);
    const primary = canonical?.split("-", 1)[0];
    if (primary && primary.length >= 2 && primary.length <= 3)
      return canonical;
  }
  catch {
    // Invalid BCP-47 tags fall back below.
  }
  return undefined;
}

export function toIntlLocale(tag: string | null | undefined, fallback = FALLBACK_LOCALE): string {
  return canonicalLocale(tag ?? "") ?? canonicalLocale(fallback) ?? FALLBACK_LOCALE;
}
