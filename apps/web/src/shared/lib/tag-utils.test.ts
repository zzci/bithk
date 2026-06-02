import { describe, expect, it } from "vitest";
import { addTag, removeTag } from "./tag-utils";

describe("addTag", () => {
  it("appends a trimmed tag", () => {
    expect(addTag(["a"], "  b  ")).toEqual(["a", "b"]);
  });

  it("ignores blank / whitespace-only input", () => {
    expect(addTag(["a"], "")).toEqual(["a"]);
    expect(addTag(["a"], "   ")).toEqual(["a"]);
  });

  it("drops case-insensitive duplicates", () => {
    expect(addTag(["Road"], "road")).toEqual(["Road"]);
    expect(addTag(["Road"], "ROAD")).toEqual(["Road"]);
  });

  it("returns a new array without mutating the input", () => {
    const list = ["a"];
    const next = addTag(list, "b");
    expect(next).not.toBe(list);
    expect(list).toEqual(["a"]);
  });
});

describe("removeTag", () => {
  it("removes a tag by exact match", () => {
    expect(removeTag(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("is case-sensitive — non-matching case is kept", () => {
    expect(removeTag(["Road"], "road")).toEqual(["Road"]);
  });

  it("returns an equivalent list when the tag is absent", () => {
    expect(removeTag(["a", "b"], "z")).toEqual(["a", "b"]);
  });
});
