/**
 * Build-time branding fallbacks for the frontend. APP_NAME remains static
 * because it namespaces browser storage; display text should use the runtime
 * branding hook and treat APP_DISPLAY_NAME only as the initial/failure fallback.
 */

const env = import.meta.env as Record<string, string | undefined>;

/** Lowercase slug. Used for filenames, localStorage keys, etc. */
const APP_NAME = env.VITE_APP_NAME ?? "app";

/** Human-readable fallback used before runtime branding loads. */
export const APP_DISPLAY_NAME = env.VITE_APP_DISPLAY_NAME ?? "App";

/**
 * Build a Web Storage key namespaced by {@link APP_NAME}. Two installs of
 * this template under the same browser origin (e.g. `/app-a` and `/app-b`
 * behind the same reverse proxy, or both at `localhost` during dev) share a
 * single localStorage / sessionStorage namespace; without the prefix, theme,
 * language, and per-feature state collide silently. Always route storage
 * keys through this helper instead of writing raw string literals.
 */
export function storageKey(suffix: string): string {
  return `${APP_NAME}:${suffix}`;
}
