import type { ActionExecutor } from "../types";
import type { Config } from "@/config";
import { promises as dns } from "node:dns";
import { z } from "zod";
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from "./spec";

// Validates the config persisted by the create-job route (already vetted
// by `validateActionConfig` against the action's `inputs[]`). Re-parsing
// at execute time catches a hand-edited DB row or a stale schema before
// the executor reaches `fetch`.
const httpRequestConfigSchema = z.object({
  url: z.string().min(1),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
  expectStatus: z.number().int().min(100).max(599).optional(),
}).passthrough();

type HttpRequestConfig = z.infer<typeof httpRequestConfigSchema>;

function parseConfig(config: Record<string, unknown>): HttpRequestConfig {
  return httpRequestConfigSchema.parse(config);
}

// IPv4 literal regex; captured groups are the four octets.
const RE_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const RE_IPV6_BRACKETS = /^\[(.*)\]$/;
const RE_IPV4_MAPPED_HEX = /^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

function isIpLiteral(host: string): boolean {
  const bare = stripIpv6Brackets(host.toLowerCase());
  if (RE_IPV4.test(bare))
    return true;
  // IPv6 literals always contain `:` (and `new URL().hostname` strips
  // the surrounding brackets).
  return bare.includes(":");
}

function stripIpv6Brackets(host: string): string {
  return host.match(RE_IPV6_BRACKETS)?.[1] ?? host;
}

function isPrivateIpv4(host: string): boolean {
  const m = host.match(RE_IPV4);
  if (!m)
    return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if ([a, b, Number(m[3]), Number(m[4])].some(n => !Number.isFinite(n) || n < 0 || n > 255))
    return false;
  if (a === 0)
    return true; // 0.0.0.0/8 — routes to loopback on Linux
  if (a === 10)
    return true;
  if (a === 100 && b >= 64 && b <= 127)
    return true; // 100.64.0.0/10 — RFC 6598 CGNAT
  if (a === 127)
    return true;
  if (a === 169 && b === 254)
    return true;
  if (a === 172 && b >= 16 && b <= 31)
    return true;
  if (a === 192 && b === 168)
    return true;
  return false;
}

function ipv4MappedToDotted(host: string): string | null {
  const dotted = host.startsWith("::ffff:") ? host.slice("::ffff:".length) : "";
  if (RE_IPV4.test(dotted))
    return dotted;

  const m = host.match(RE_IPV4_MAPPED_HEX);
  if (!m)
    return null;
  const hi = Number.parseInt(m[1]!, 16);
  const lo = Number.parseInt(m[2]!, 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi < 0 || hi > 0xFFFF || lo < 0 || lo > 0xFFFF)
    return null;
  return `${hi >> 8}.${hi & 0xFF}.${lo >> 8}.${lo & 0xFF}`;
}

/**
 * Reject loopback / private / link-local / unique-local destinations so a
 * compromised admin session cannot pivot from an `http-request` job into
 * cloud metadata (`169.254.169.254`) or internal services. Operators can
 * opt out per-deployment via `HTTP_ACTION_ALLOW_PRIVATE=true` for
 * legitimate sidecar pings.
 *
 * Hostnames that are not IP literals are not resolved here — DNS rebind
 * defence belongs in the network layer, not the application layer.
 */
export function isPrivateDestination(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname.toLowerCase());
  if (host === "localhost" || host === "::1" || host === "::" || host === "0.0.0.0")
    return true;
  if (RE_IPV4.test(host))
    return isPrivateIpv4(host);

  // IPv6 literals are enclosed in brackets in URLs, but `new URL().hostname`
  // strips them; the result still contains `:`. Reject the unique-local /
  // link-local prefixes by string match.
  if (host.includes(":")) {
    const mapped = ipv4MappedToDotted(host);
    if (mapped)
      return isPrivateIpv4(mapped);

    const firstGroup = Number.parseInt(host.split(":")[0] || "0", 16);
    if ((firstGroup & 0xFE00) === 0xFC00)
      return true;
    if ((firstGroup & 0xFFC0) === 0xFE80)
      return true;
  }
  return false;
}

/**
 * Validate one request target against the SSRF gate and, when we resolve
 * the hostname ourselves, PIN the connection to a vetted IP so `fetch`
 * cannot re-resolve to a rebound (private) address between our check and
 * the socket connect — closing the TOCTOU window. Run for the initial URL
 * AND for every redirect hop, so a 3xx pointing at a private host cannot
 * bypass the guard.
 *
 * Throws on a private destination, an unsupported protocol, an invalid
 * URL, or a failed lookup. `HTTP_ACTION_ALLOW_PRIVATE=true` lets operators
 * opt out for legitimate sidecar / loopback pings.
 */
export interface ResolvedTarget {
  /** URL `fetch` connects to — host rewritten to the pinned IP when we resolved DNS ourselves. */
  readonly requestUrl: string;
  /** Original authority for the `Host` header (only meaningful when pinned). */
  readonly host: string;
  /** SNI / cert hostname for HTTPS when pinned; null otherwise. */
  readonly serverName: string | null;
  /** True when the authority was rewritten to a pinned IP. */
  readonly pinned: boolean;
}

export async function resolveTarget(config: Pick<Config, "HTTP_ACTION_ALLOW_PRIVATE">, rawUrl: string): Promise<ResolvedTarget> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  }
  catch {
    throw new Error(`invalid URL: ${rawUrl}`);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")
    throw new Error(`unsupported protocol: ${parsedUrl.protocol}`);

  let connectHost = parsedUrl.hostname;
  if (!config.HTTP_ACTION_ALLOW_PRIVATE) {
    if (isPrivateDestination(parsedUrl.hostname))
      throw new Error(`refused private destination ${parsedUrl.hostname} (set HTTP_ACTION_ALLOW_PRIVATE=true to allow)`);
    // Resolve the hostname ONCE, validate every returned address, then
    // connect to the validated IP directly. `fetch` is given the IP, not
    // the name, so it performs no second resolution — a rebind to a
    // private address after this check can no longer take effect. The DNS
    // lookup also catches IPv6 link-local / unique-local destinations the
    // hostname-literal check above cannot.
    if (!isIpLiteral(parsedUrl.hostname)) {
      let addrs: readonly { address: string; family: number }[];
      try {
        addrs = await dns.lookup(parsedUrl.hostname, { all: true });
      }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`DNS lookup for ${parsedUrl.hostname} failed: ${msg}`);
      }
      for (const a of addrs) {
        if (isPrivateDestination(a.address))
          throw new Error(`refused destination ${parsedUrl.hostname} (resolves to private ${a.address}; set HTTP_ACTION_ALLOW_PRIVATE=true to allow)`);
      }
      const pinned = addrs[0];
      if (!pinned)
        throw new Error(`DNS lookup for ${parsedUrl.hostname} returned no addresses`);
      // IPv6 literals must be bracketed in a URL authority.
      connectHost = pinned.family === 6 ? `[${pinned.address}]` : pinned.address;
    }
  }

  if (connectHost === parsedUrl.hostname)
    return { requestUrl: rawUrl, host: parsedUrl.host, serverName: null, pinned: false };

  const pinnedUrl = new URL(rawUrl);
  pinnedUrl.hostname = connectHost;
  return {
    requestUrl: pinnedUrl.toString(),
    host: parsedUrl.host,
    serverName: parsedUrl.protocol === "https:" ? parsedUrl.hostname : null,
    pinned: true,
  };
}

// Cap how many 3xx hops we chase. Every hop is re-vetted by
// `resolveTarget`, so this only bounds redirect loops / long chains.
const MAX_REDIRECTS = 5;

/**
 * Issue one HTTP request against the configured URL, following up to
 * `MAX_REDIRECTS` redirects MANUALLY so every hop is re-checked against
 * the SSRF gate. `fetch`'s default `redirect: "follow"` would only vet
 * the first hop, letting a vetted public URL bounce us to
 * `169.254.169.254` (cloud metadata) or an internal host. The returned
 * status string lands in `cron_job_logs.result` (on success) or in the
 * thrown `Error.message` → `cron_job_logs.error` (on failure / wrong
 * status).
 *
 * Use cases: external health pings, webhook fan-out, third-party API
 * keep-alives. NOT a replacement for a real HTTP monitoring tool —
 * there's no retry, no backoff, and no SLO bookkeeping. Pair with the
 * audit + run-history surface for visibility.
 */
export const execute: ActionExecutor = async (ctx, config) => {
  const cfg = parseConfig(config);
  const method = (cfg.method ?? "GET").toUpperCase();
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const expectStatus = cfg.expectStatus;

  const startedAt = Date.now();
  // One deadline shared across every hop so a redirect chain cannot
  // multiply the configured timeout.
  const signal = AbortSignal.timeout(Math.min(timeoutMs, ctx.config.HTTP_ACTION_TIMEOUT_SECONDS * 1000));

  // `currentUrl` is always the LOGICAL url (original hostname); redirect
  // `Location`s resolve against it, and `resolveTarget` re-pins per hop.
  let currentUrl = cfg.url;
  let res: Response;
  for (let hop = 0; ; hop++) {
    const target = await resolveTarget(ctx.config, currentUrl);

    const init: RequestInit = {
      method,
      // Never let `fetch` follow on its own — see `resolveTarget`.
      redirect: "manual",
      signal,
    };
    const headers = new Headers(cfg.headers);
    if (target.pinned) {
      // Pinned to a resolved IP: keep `Host` so virtual-host routing and
      // the IdP's expectations still work; for HTTPS set SNI + the
      // cert-validation hostname (the cert is NOT validated against the IP).
      headers.set("Host", target.host);
      if (target.serverName) {
        (init as RequestInit & { tls?: { serverName: string } }).tls = {
          serverName: target.serverName,
        };
      }
    }
    init.headers = headers;
    if (method !== "GET" && method !== "HEAD" && cfg.body !== undefined)
      init.body = cfg.body;

    try {
      res = await fetch(target.requestUrl, init);
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${method} ${cfg.url} failed: ${msg}`);
    }

    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location)
      break;
    if (hop >= MAX_REDIRECTS)
      throw new Error(`${method} ${cfg.url} → exceeded ${MAX_REDIRECTS} redirects`);

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    }
    catch {
      throw new Error(`${method} ${cfg.url} → ${res.status} with invalid redirect Location`);
    }
    // Release the intermediate connection before chasing the next hop.
    await res.body?.cancel().catch(() => {});
    currentUrl = nextUrl;
  }

  const durationMs = Date.now() - startedAt;
  const expected = expectStatus ?? null;
  const ok = expected === null ? res.ok : res.status === expected;
  if (!ok) {
    ctx.logger.warn(
      { url: cfg.url, method, status: res.status, durationMs, expected },
      "cron_http_request_unexpected_status",
    );
    // The response body is deliberately NOT persisted: a target that
    // reflects tokens/secrets would otherwise leak them into
    // cron_job_logs.error and the trigger response. Status + duration is
    // the persisted signal.
    throw new Error(
      `${method} ${cfg.url} → ${res.status} (expected ${expected ?? "2xx"}, ${durationMs}ms)`,
    );
  }

  ctx.logger.debug(
    { url: cfg.url, method, status: res.status, durationMs },
    "cron_http_request_ok",
  );
  return `${method} ${cfg.url} → ${res.status} (${durationMs}ms)`;
};
