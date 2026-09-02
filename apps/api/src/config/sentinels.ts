import type { Config } from "./schema";
import { isSpoofableProxyConfig } from "@/shared/lib/client-ip";
import { ConfigError } from "./errors";

/**
 * Values left in a fork that copied the `.env.example` dev-IdP block or the
 * e2e `tests/e2e/dex/config.yaml` verbatim. Refusing to boot in production with any of
 * these in place catches the most common "deployed the example and
 * forgot to rotate" mistake.
 *
 * Keep entries human-grep-able: if a future operator searches for the
 * literal sentinel that surfaced in their boot log, they should land
 * here and see the matching rotation hint immediately.
 */
const PRODUCTION_SENTINELS = [
  { field: "OAUTH_CLIENT_SECRET", sentinel: "app-secret", hint: "Rotate it and the matching `secret` in dex.yaml / your IdP." },
  { field: "OAUTH_CLIENT_ID", sentinel: "app", hint: "Register a real client id in your IdP." },
  { field: "DEFAULT_ADMIN", sentinel: "admin@example.com", hint: "Set DEFAULT_ADMIN to the real first-admin email." },
] as const;

/**
 * Refuse to boot in production when example sentinels from the
 * compose stack are still in place. Throws `ConfigError` on the
 * first match so the operator sees one actionable message at a time.
 * No-op outside production.
 */
export function assertProductionSentinels(data: Config): void {
  if (data.NODE_ENV !== "production")
    return;
  for (const { field, sentinel, hint } of PRODUCTION_SENTINELS) {
    if (data[field] === sentinel) {
      throw new ConfigError(
        `${field} still uses the example value \`${sentinel}\`.`,
        { field, hint },
      );
    }
  }
}

/**
 * Production-only network boundary guards. Both fields are required
 * whenever OAuth is in play (the IdP needs APP_URL to redirect
 * back; the CSRF guard needs CORS_ORIGIN to bound mutating
 * requests). Pure single-user deployments may legitimately omit
 * either — the warn-instead-of-throw branch covers that case.
 *
 * Returns a list of non-fatal warnings the caller should surface so
 * production single-user deployments are at least noisy about their
 * relaxed posture.
 */
export function assertProductionNetworkGuards(data: Config, oauthInPlay: boolean): readonly string[] {
  if (data.NODE_ENV !== "production")
    return [];

  const warnings: string[] = [];

  if (!data.CORS_ORIGIN && oauthInPlay) {
    throw new ConfigError("CORS_ORIGIN is required in production", { field: "CORS_ORIGIN" });
  }
  if (!data.APP_URL) {
    if (oauthInPlay) {
      throw new ConfigError(
        "APP_URL is required in production (forwarded headers are not trusted to derive OAuth callback URLs).",
        { field: "APP_URL" },
      );
    }
    warnings.push(
      "[config] APP_URL is unset in production single-user mode — the CSRF guard cannot enforce origin checks without it.",
    );
  }

  // `TRUST_PROXY=true` with an empty `TRUSTED_PROXY_IPS` allow-list is now
  // fail-closed at the IP layer (forwarding headers are ignored — see
  // `getClientIp`), so per-client IP controls collapse onto the single proxy
  // peer. Surface the config requirement: set `TRUSTED_PROXY_IPS` to restore
  // real client IPs, and keep `APP_URL` / `CORS_ORIGIN` set so origin-based
  // CSRF defence stays effective while IP-keyed limits are degraded.
  if (isSpoofableProxyConfig(data)) {
    warnings.push(
      "[config] TRUST_PROXY=true with an empty TRUSTED_PROXY_IPS allow-list: forwarding headers are ignored in production (fail closed). Set TRUSTED_PROXY_IPS to your proxy subnet, and ensure APP_URL / CORS_ORIGIN are configured for origin-based CSRF defence.",
    );
  }

  return warnings;
}
