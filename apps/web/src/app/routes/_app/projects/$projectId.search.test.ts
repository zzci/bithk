import { describe, expect, it } from "vitest";
import { validateProjectDetailSearch } from "./$projectId";

describe("validateProjectDetailSearch", () => {
  it("keeps the settings deep-link flag", () => {
    expect(validateProjectDetailSearch({ settings: true })).toEqual({ settings: true });
    expect(validateProjectDetailSearch({ settings: "true" })).toEqual({ settings: true });
  });

  it("drops the flag when absent or falsy (tabs are routes now, not search params)", () => {
    expect(validateProjectDetailSearch({})).toEqual({});
    expect(validateProjectDetailSearch({ settings: false })).toEqual({});
    expect(validateProjectDetailSearch({ tab: "issues" })).toEqual({});
  });
});
