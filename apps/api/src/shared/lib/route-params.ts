import type { Context, Env } from "hono";
import { ValidationError } from "@/shared/lib/errors";

/**
 * Read a required path parameter without a non-null assertion.
 *
 * Hono types `c.req.param(name)` as `string | undefined` under
 * `noUncheckedIndexedAccess`, which previously forced a `c.req.param("id")!`
 * at every call site. For a route whose pattern declares `:name` the value is
 * always present once the route matched, so the throw is unreachable in
 * practice — it only fires if a handler is wired to a param the path never
 * declares, which is a wiring bug worth surfacing rather than passing
 * `undefined` downstream.
 *
 * Generic over `Env` so it accepts both `Context<AppEnv>` and the narrower
 * `Context<ProtectedEnv>` used by protected route sub-apps.
 */
export function requireParam<E extends Env>(c: Context<E>, name: string): string {
  const value = c.req.param(name);
  if (value === undefined)
    throw new ValidationError(`missing route parameter: ${name}`, { param: name });
  return value;
}
