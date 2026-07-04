// Ergonomic access to the generated OpenAPI types (api-types.ts). Data-layer
// modules import these lookups instead of spelling deep
// `paths[...]["get"]["responses"]` chains. The spec inlines nearly every
// schema per path (hono-openapi emits no shared components), so the
// operation-keyed helpers below are the primary entry point.
import type { components, operations } from "./api-types";

export type { components, operations, paths } from "./api-types";

/** Named schema from `components.schemas` (rare — most shapes are inline per path). */
export type ApiSchema<K extends keyof components["schemas"]> = components["schemas"][K];

/** JSON body of an operation's response for a given status (default 200). */
export type ApiResponse<
  Op extends keyof operations,
  Status extends keyof operations[Op]["responses"] = 200 & keyof operations[Op]["responses"],
> = operations[Op]["responses"][Status] extends { content: { "application/json": infer Body } }
  ? Body
  : never;

/** The `data` payload inside an operation's 200 success envelope. */
export type ApiData<Op extends keyof operations>
  = ApiResponse<Op> extends { data: infer Data } ? Data : never;

/** Element type of a list operation's `data` array. */
export type ApiRow<Op extends keyof operations>
  = ApiData<Op> extends readonly (infer Row)[] ? Row : never;
