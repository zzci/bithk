import type { NavItem } from "./types";

/**
 * Keep only the nav items the user may see: items without a `module` key are
 * always visible; module-gated items require the key in `me.modules`. Admins
 * receive every key from the API, so a plain membership test suffices. A
 * missing list (user not loaded) fails closed and hides all gated items.
 */
export function filterNavByModules(
  items: readonly NavItem[],
  modules: readonly string[] | undefined,
): NavItem[] {
  return items.filter(item => !item.module || (modules ?? []).includes(item.module));
}
