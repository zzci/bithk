import type { JsonObject } from "./types";

// Shared OpenAPI components every module reuses via `$ref`. The PAT bearer
// scheme is the single security mechanism the spec advertises (FEAT-034).

export const SECURITY_SCHEMES: Record<string, JsonObject> = {
  bearerAuth: {
    type: "http",
    scheme: "bearer",
    description:
      "Personal Access Token (`bithk_pat_…`). Effective access is the owner's "
      + "permissions intersected with the token's per-module read/write scope.",
  },
};

export const COMPONENT_SCHEMAS: Record<string, JsonObject> = {
  // Error envelope returned by every failed request.
  ErrorResponse: {
    type: "object",
    required: ["success", "error"],
    properties: {
      success: { type: "boolean", const: false },
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string", description: "Machine error code, e.g. TOKEN_SCOPE_INSUFFICIENT." },
          message: { type: "string" },
          details: { type: "object", additionalProperties: true, description: "Field-level validation errors when present." },
        },
      },
    },
  },
  // Pagination metadata attached to list responses that page.
  PageMeta: {
    type: "object",
    properties: {
      total: { type: "integer" },
      page: { type: "integer" },
      limit: { type: "integer" },
      totalPages: { type: "integer" },
    },
  },
  // A comment on an issue / document / procurement (shared item-comment shape).
  Comment: {
    type: "object",
    properties: {
      id: { type: "string" },
      itemId: { type: "string" },
      authorId: { type: "string" },
      content: { type: "string" },
      replyToId: { type: ["string", "null"] },
      isInternal: { type: "boolean" },
      createdAt: { type: "string" },
    },
  },
  CommentCreate: {
    type: "object",
    required: ["content"],
    properties: {
      content: { type: "string", maxLength: 2000, description: "Required unless an attachment is included." },
      replyToId: { type: "string", description: "Another comment id on the same item." },
    },
  },
  // A file attachment reference (shared across issue/document/etc. attachments).
  Attachment: {
    type: "object",
    properties: {
      id: { type: "string" },
      fileId: { type: "string" },
      ownerType: { type: "string" },
      ownerId: { type: "string" },
      filename: { type: "string" },
      mimetype: { type: "string" },
      size: { type: "integer" },
      createdBy: { type: "string" },
      createdAt: { type: "string" },
    },
  },
  Tag: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      type: { type: "string" },
    },
  },
};
