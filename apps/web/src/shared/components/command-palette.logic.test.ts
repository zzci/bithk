import type { SearchHit } from "@/shared/lib/api/search";
import { describe, expect, it } from "vitest";
import { hitTarget, matchesQuery } from "./command-palette.logic";

describe("hitTarget", () => {
  it("maps each hit type to its deep-link route", () => {
    expect(hitTarget({ type: "document", id: "d1", title: "x" })).toEqual({
      to: "/documents/$docId",
      params: { docId: "d1" },
    });
    expect(hitTarget({ type: "issue", id: "i1", title: "x", projectId: "p1" })).toEqual({
      to: "/projects/$projectId/issues/$issueId",
      params: { projectId: "p1", issueId: "i1" },
    });
    expect(hitTarget({ type: "project", id: "p1", title: "x" })).toEqual({
      to: "/projects/$projectId",
      params: { projectId: "p1" },
    });
  });

  it("sends drive hits to the drive root (no deep link yet)", () => {
    const hit: SearchHit = { type: "drive", id: "e1", title: "file.txt" };
    expect(hitTarget(hit)).toEqual({ to: "/drive" });
  });
});

describe("matchesQuery", () => {
  it("matches everything for an empty or whitespace query", () => {
    expect(matchesQuery("Overview", "")).toBe(true);
    expect(matchesQuery("Overview", "   ")).toBe(true);
  });

  it("matches case-insensitively on substring", () => {
    expect(matchesQuery("Documents", "doc")).toBe(true);
    expect(matchesQuery("Documents", "DOC")).toBe(true);
    expect(matchesQuery("Documents", "ment")).toBe(true);
  });

  it("rejects non-substring queries", () => {
    expect(matchesQuery("Projects", "drive")).toBe(false);
  });
});
