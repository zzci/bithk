import type { Context } from "hono";
import type { OpenAPIV3_1 } from "openapi-types";
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

/**
 * A `describeRoute` `requestBody` documenting `schema` as JSON. Use for routes
 * that validate their body inline (not via `validator`) so the body still
 * appears in the spec — `resolver()` is NOT honoured in the `requestBody`
 * position (only in `responses`), so emit a concrete JSON Schema instead.
 * Doc-only: it changes no runtime behaviour.
 */
export function jsonRequestBody(schema: z.ZodType): OpenAPIV3_1.RequestBodyObject {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema; // redundant inside an OpenAPI Schema Object
  return {
    content: { "application/json": { schema: json as OpenAPIV3_1.SchemaObject } },
  };
}

// `{ success:true, data }` response doc for `schema`.
export function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}

// The canonical paginated-list `meta` (`{ total, page, limit }`). Modules whose
// runtime meta carries extra fields extend it (`pageMetaSchema.extend(...)`)
// and pass the result to `okListJson` so the spec keeps matching the wire.
export const pageMetaSchema = z.object({ total: z.number(), page: z.number(), limit: z.number() });

// Paginated `{ success:true, data:[…], meta }` response doc.
export function okListJson(itemSchema: z.ZodType, description = "Success", metaSchema: z.ZodType = pageMetaSchema) {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: z.array(itemSchema), meta: metaSchema })) } } };
}

// Error-body response doc; spread next to a per-status `description`.
export const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

export { describeRoute, resolver, validator };
