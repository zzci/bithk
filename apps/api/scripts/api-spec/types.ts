// Authoring types for the per-module OpenAPI fragments. Operations are kept as
// loose JSON objects (OpenAPI Operation Objects) so lanes can author rich specs
// without fighting a full OpenAPI type. The assembler (`index.ts`) groups them
// into the final document and auto-stubs any route a module hasn't curated.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type JsonObject = Record<string, unknown>;

export interface OperationEntry {
  readonly method: HttpMethod;
  /** Hono-style path, no `/api` prefix, e.g. `/projects/:projectId/issues`. */
  readonly path: string;
  /** An OpenAPI Operation Object (summary, parameters, requestBody, responses, …). */
  readonly operation: JsonObject;
}

export interface ModuleSpec {
  /** Component schemas this module contributes; merged into `components.schemas`. */
  readonly schemas?: Record<string, JsonObject>;
  readonly operations: readonly OperationEntry[];
}
