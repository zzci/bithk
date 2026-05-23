import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessPublicShare, getPublicShareMeta } from "./share";

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

describe("getPublicShareMeta", () => {
  it("requests share metadata and unwraps the envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        token: "tok",
        resourceType: "document",
        name: "Doc",
        isFolder: false,
        permission: "view",
        requiresPassword: true,
        expired: false,
        exhausted: false,
      },
    }));
    const meta = await getPublicShareMeta("tok");
    expect(meta.token).toBe("tok");
    expect(meta.resourceType).toBe("document");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/shared/tok");
    // GET must not carry the CSRF header.
    expect((init?.headers as Record<string, string>)["X-Requested-With"]).toBeUndefined();
  });
});

describe("accessPublicShare", () => {
  it("sends password + childId and the CSRF header", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { document: { id: "d1", title: "Doc", content: "# hi" }, attachments: [], subtree: [] },
    }));
    const content = await accessPublicShare<{ document: { id: string } }>("tok", { password: "pw", childId: "d1" });
    expect(content.document.id).toBe("d1");
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(JSON.parse(init.body as string)).toEqual({ password: "pw", childId: "d1" });
  });

  it("omits password and childId when not provided", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { name: "file.txt", isFolder: false, file: null, permission: "download" },
    }));
    await accessPublicShare("tok");
    const init = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string)).toEqual({});
  });
});
