// Small primitives reused across the unified share UI: the visible-users
// picker source, a clipboard hook with transient feedback, byte/date
// formatters, and the public-link expiry <-> select-bucket conversions.

import type { SimpleUser } from "@/shared/lib/api/documents";
import { useQuery } from "@tanstack/react-query";
import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import { http } from "@/shared/lib/http";

/** Visible users for the direct-share / member pickers (shared client). */
export function useVisibleUsers() {
  return useQuery({
    queryKey: ["account", "visible-users"],
    queryFn: () => http<{ readonly data: readonly SimpleUser[] }>("/account/visible-users").then(r => r.data),
    staleTime: 30_000,
  });
}

/**
 * Clipboard helper with a transient "copied" flag for button feedback.
 * Re-exported from the canonical shared hook so existing share consumers keep
 * the `useClipboard` name.
 */
export const useClipboard = useCopyToClipboard;

/** Public-link expiry select value → absolute ISO timestamp (or null). */
export function expiresAtFromValue(value: string): string | null {
  if (value === "never")
    return null;
  const days = Number(value);
  if (!Number.isFinite(days))
    return null;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/** Absolute expiry → the closest select bucket the UI offers. */
export function expirationValueFrom(expiresAt: string | null | undefined): string {
  if (!expiresAt)
    return "never";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0)
    return "never";
  const days = Math.ceil(diff / 86_400_000);
  if (days <= 1)
    return "1";
  if (days <= 7)
    return "7";
  return "30";
}
