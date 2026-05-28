import type { Document } from "./documents";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import { HttpError } from "../http";
import {
  documentsKeys,
  DocumentVersionConflictError,
  parseTags,
  patchDocument,
  useCreateDocument,
  useDeleteDocument,
  useDocument,
  useDocumentTags,
  useDocumentTree,
  useMoveDocument,
  useSetDocumentPin,
} from "./documents";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function doc(overrides: Partial<Document> = {}): Document {
  return {
    id: "d1",
    title: "Doc",
    content: "body",
    tags: "[]",
    parentId: null,
    version: 1,
    ...overrides,
  } as Document;
}

describe("parseTags", () => {
  it("returns an empty array for null/undefined/empty", () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });

  it("parses a JSON array of tags", () => {
    expect(parseTags("[\"a\",\"b\"]")).toEqual(["a", "b"]);
  });

  it("ignores non-array JSON", () => {
    expect(parseTags("{\"a\":1}")).toEqual([]);
    expect(parseTags("42")).toEqual([]);
  });

  it("swallows malformed JSON and returns an empty array", () => {
    expect(parseTags("not json")).toEqual([]);
  });
});

describe("documentsKeys", () => {
  it("namespaces detail and nested keys", () => {
    expect(documentsKeys.detail("d1")).toEqual(["documents", "detail", "d1"]);
    expect(documentsKeys.shares("d1")).toEqual(["documents", "d1", "shares"]);
  });
});

describe("patchDocument", () => {
  it("returns the updated document on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: doc({ title: "Renamed", version: 2 }) }));
    const updated = await patchDocument("d1", { title: "Renamed", version: 1 });
    expect(updated.title).toBe("Renamed");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/documents/d1");
    expect(init?.method).toBe("PATCH");
  });

  it("throws a typed conflict error carrying the fresh row on 409", async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init?.method ?? "GET") === "PATCH") {
        return jsonResponse(
          { success: false, error: { code: "VERSION_CONFLICT", message: "stale" } },
          { status: 409 },
        );
      }
      // Refetch of the current row.
      return jsonResponse({ success: true, data: doc({ version: 5, title: "Server" }) });
    });
    await expect(patchDocument("d1", { title: "Mine", version: 1 })).rejects.toBeInstanceOf(
      DocumentVersionConflictError,
    );
    try {
      await patchDocument("d1", { title: "Mine", version: 1 });
    }
    catch (err) {
      expect(err).toBeInstanceOf(DocumentVersionConflictError);
      expect((err as DocumentVersionConflictError).current.version).toBe(5);
    }
  });

  it("rethrows non-conflict HTTP errors unchanged", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "denied" } },
      { status: 403 },
    ));
    await expect(patchDocument("d1", { title: "x", version: 1 })).rejects.toBeInstanceOf(HttpError);
  });
});

describe("document queries", () => {
  it("fetches the tree", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    const { result } = renderHook(() => useDocumentTree(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/documents/tree");
  });

  it("does not fetch a document without an id", () => {
    const { result } = renderHook(() => useDocument(undefined), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Document tags are their own typed vocabulary: the list comes from the
  // document-scoped `/documents/tags` route as a plain string[], never the
  // global `/tags` (project) endpoint.
  it("fetches the document tag list from /documents/tags as a string array", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: ["alpha", "beta"] }));
    const { result } = renderHook(() => useDocumentTags(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/documents/tags");
    expect(result.current.data).toEqual(["alpha", "beta"]);
  });
});

describe("document mutations", () => {
  it("creates a document via POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: doc() }));
    const { result } = renderHook(() => useCreateDocument(), { wrapper: makeWrapper() });
    await result.current.mutateAsync({ title: "New" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/documents");
    expect(init?.method).toBe("POST");
  });

  it("deletes a document via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useDeleteDocument(), { wrapper: makeWrapper() });
    await result.current.mutateAsync("d1");
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("DELETE");
  });

  it("pins with PUT and unpins with DELETE", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: true, data: { pinned: true } }));
    const pin = renderHook(() => useSetDocumentPin(), { wrapper: makeWrapper() });
    await pin.result.current.mutateAsync({ id: "d1", pin: true });
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("PUT");
    await pin.result.current.mutateAsync({ id: "d1", pin: false });
    expect(fetchMock.mock.calls[1]![1]?.method).toBe("DELETE");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/documents/d1/pin");
  });

  it("moves a document, sending the new parent and version", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: doc({ parentId: "p2" }) }));
    const { result } = renderHook(() => useMoveDocument(), { wrapper: makeWrapper() });
    const moved = await result.current.mutateAsync({ id: "d1", parentId: "p2", version: 1 });
    expect(moved.parentId).toBe("p2");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/documents/d1/move");
    expect(JSON.parse(String(init?.body))).toEqual({ parentId: "p2", version: 1 });
  });
});
