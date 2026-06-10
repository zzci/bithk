/**
 * Shared secret-field redaction (PLAN-075 R6 — redaction parity).
 *
 * Single source of truth for the secret-typed field names scrubbed from
 * token-route backup exports. Consumed by the v1 JSON token export
 * (`export.routes.ts`) and the v2 redacted NDJSON writer
 * (`archive.service.ts`). Extraction from `export.routes.ts` is
 * behavior-neutral — same set, same sentinel, same recursive walk.
 */

// Secret-typed field names (drizzle property keys) that may appear in a
// backup-exported row. Their values are redacted in the *token* export so a
// leaked backup token cannot exfiltrate live credentials:
//  - `taskConfig`  cron_jobs JSON blob (http-request Bearer headers / `secret` inputs)
//  - `token` / `password`  public-share secret handle + argon2id hash (`shares`)
//  - `secret`  TOTP device seed (`user_totp_devices`)
//  - `accessToken` / `refreshToken`  session + TOTP-challenge OAuth material
//  - `codeVerifier`  PKCE verifier HMAC
// Matched at ANY nesting depth so secrets buried inside a decoded JSON blob are
// caught too. None of these names collides with a benign exported column.
export const SECRET_FIELD_NAMES = new Set<string>([
  "taskConfig",
  "token",
  "password",
  "secret",
  "accessToken",
  "refreshToken",
  "codeVerifier",
]);

export const REDACTED = "[REDACTED]";

/** Replace every secret-named field (at any depth) with the sentinel. Pure. */
export function redactSecretFields(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(redactSecretFields);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = SECRET_FIELD_NAMES.has(k) ? REDACTED : redactSecretFields(v);
    return out;
  }
  return value;
}
