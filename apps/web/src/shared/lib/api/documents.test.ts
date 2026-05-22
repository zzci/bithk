import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessPublicDocument, getPublicDocument } from "./documents";

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

describe("getPublicDocument", () => {
  it("requests share metadata and unwraps the envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { token: "tok", title: "Doc", hasPassword: true },
    }));
    const meta = await getPublicDocument("tok");
    expect(meta).toEqual({ token: "tok", title: "Doc", hasPassword: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/documents/shared/tok");
    // GET must not carry the CSRF header.
    expect((init?.headers as Record<string, string>)["X-Requested-With"]).toBeUndefined();
  });
});

describe("accessPublicDocument", () => {
  it("sends password + docId and the CSRF header", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        token: "tok",
        hasPassword: true,
        document: { id: "d1", title: "Doc", content: "# hi", parentId: null },
        attachments: [],
        subtree: [{ id: "d1", title: "Doc", parentId: null }],
      },
    }));
    const content = await accessPublicDocument("tok", { password: "pw", docId: "d1" });
    expect(content.document.id).toBe("d1");
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(JSON.parse(init.body as string)).toEqual({ password: "pw", docId: "d1" });
  });

  it("omits password and docId when not provided", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { token: "tok", hasPassword: false, document: { id: "d1" }, attachments: [], subtree: [] },
    }));
    await accessPublicDocument("tok");
    const init = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string)).toEqual({});
  });
});
