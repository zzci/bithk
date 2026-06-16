import type { Context } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";

// The canonical error body (`{ success:false, error:{ code, message, details? } }`).
// Reuse it via `resolver(ErrorEnvelope)` for 4xx/5xx response docs so every
// module documents errors identically.
export const ErrorEnvelope = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

// Thin re-exports + one shared hook so every route documents itself the same
// way and keeps the app's error contract (FEAT-035). `describeRoute` adds
// summary/tags/responses to the generated OpenAPI; `validator` validates a
// request part AND contributes its schema to the spec; `resolver` turns a Zod
// schema into an OpenAPI schema for responses.
//
// hono-openapi's `validator` answers a failed request with its own `400` and a
// non-standard body. Pass `onValidationFailure` as the 3rd arg so failures
// return the app's canonical `{ success:false, error:{ code, message, details } }`
// 422 instead — unchanged from the previous inline `schema.parse()` behaviour
// (the global error handler maps a thrown `ZodError` to the same 422).
export function onValidationFailure(
  result: { readonly success: boolean; readonly error?: unknown },
  c: Context,
) {
  if (!result.success) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Validation failed", details: result.error } },
      422,
    );
  }
}

export { describeRoute, resolver, validator };
