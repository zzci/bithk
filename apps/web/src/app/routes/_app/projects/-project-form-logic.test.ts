import { describe, expect, it } from "vitest";
import { addTag, projectsFilterToQuery, removeTag } from "./-project-form-logic";

describe("projectsFilterToQuery", () => {
  it("maps __active__ to an active status filter (the default)", () => {
    expect(projectsFilterToQuery("__active__")).toEqual({ status: "active" });
  });

  it("maps __archived__ to an archived status filter", () => {
    expect(projectsFilterToQuery("__archived__")).toEqual({ status: "archived" });
  });

  it("maps any other value to a tag id filter", () => {
    expect(projectsFilterToQuery("tag123")).toEqual({ tagId: "tag123" });
  });
});

describe("addTag / removeTag", () => {
  it("appends a trimmed tag", () => {
    expect(addTag(["a"], " b ")).toEqual(["a", "b"]);
  });

  it("ignores blank input", () => {
    expect(addTag(["a"], "   ")).toEqual(["a"]);
  });

  it("ignores case-insensitive duplicates", () => {
    expect(addTag(["Alpha"], "alpha")).toEqual(["Alpha"]);
  });

  it("removes by exact match", () => {
    expect(removeTag(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("is a no-op when the tag is absent", () => {
    expect(removeTag(["a"], "z")).toEqual(["a"]);
  });
});
