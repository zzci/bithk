/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import type { ModuleKey } from "@/shared/components/sidebar/types";
import { Navigate, useRouterState } from "@tanstack/react-router";
import { getNavItems } from "@/shared/components/sidebar/registry";
import { useAuthStore } from "@/shared/stores/auth";

/**
 * Map a pathname to the module key that owns it, derived from the main-area
 * nav registry (`matchPrefix ?? path` is the module's route-group prefix) so
 * the guard stays in sync with the sidebar automatically. Returns null for
 * ungated routes (overview; the admin area keeps its own role guard).
 */
export function routeModule(pathname: string): ModuleKey | null {
  for (const item of getNavItems("overview")) {
    if (!item.module)
      continue;
    const prefix = item.matchPrefix ?? item.path;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`))
      return item.module;
  }
  return null;
}

/**
 * Generic module route guard (PLAN-076): deep links into a module outside
 * `me.modules` redirect to /overview, mirroring the `_app/admin` gate. The
 * backend additionally answers hidden-module API calls with 404, so this is
 * purely a navigation nicety, not the security boundary.
 */
export function ModuleGuard({ children }: { readonly children: ReactNode }) {
  const user = useAuthStore(s => s.user);
  const pathname = useRouterState({ select: s => s.location.pathname });

  const module = routeModule(pathname);
  if (module && !(user?.modules ?? []).includes(module)) {
    return <Navigate to="/overview" />;
  }

  return children;
}
