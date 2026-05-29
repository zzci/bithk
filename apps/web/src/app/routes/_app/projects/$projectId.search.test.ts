import { describe, expect, it } from "vitest";
import { validateProjectDetailSearch } from "./$projectId";

describe("validateProjectDetailSearch", () => {
  it("restores a known tab so back/close can land on the issues tab", () => {
    expect(validateProjectDetailSearch({ tab: "issues" })).toEqual({ tab: "issues" });
    expect(validateProjectDetailSearch({ tab: "procurement" })).toEqual({ tab: "procurement" });
    expect(validateProjectDetailSearch({ tab: "files" })).toEqual({ tab: "files" });
  });

  it("omits the tab param for the default overview tab", () => {
    expect(validateProjectDetailSearch({ tab: "overview" })).toEqual({});
  });

  it("drops absent or unknown tab values so existing deep-links default to overview", () => {
    expect(validateProjectDetailSearch({})).toEqual({});
    expect(validateProjectDetailSearch({ tab: "bogus" })).toEqual({});
    expect(validateProjectDetailSearch({ tab: 1 })).toEqual({});
  });

  it("keeps the settings deep-link flag and combines it with the tab param", () => {
    expect(validateProjectDetailSearch({ settings: true })).toEqual({ settings: true });
    expect(validateProjectDetailSearch({ settings: "true" })).toEqual({ settings: true });
    expect(validateProjectDetailSearch({ settings: true, tab: "issues" })).toEqual({ settings: true, tab: "issues" });
  });
});
