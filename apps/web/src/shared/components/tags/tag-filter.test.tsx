import { describe, expect, it } from "vitest";
import { tagFilterDimension } from "./tag-filter";

describe("tagFilterDimension", () => {
  it("returns null when there are no tags", () => {
    expect(tagFilterDimension({ tags: [], value: [], onChange: () => {}, label: "Tags" })).toBeNull();
  });

  it("returns a multi dimension with options mapped from tags", () => {
    const dim = tagFilterDimension({
      tags: [
        { id: "1", name: "alpha" },
        { id: "2", name: "beta" },
      ],
      value: ["1"],
      onChange: () => {},
      label: "Tags",
    });

    expect(dim).not.toBeNull();
    expect(dim?.mode).toBe("multi");
    expect(dim?.key).toBe("tags");
    expect(dim?.label).toBe("Tags");
    expect(dim?.options).toEqual([
      { value: "1", label: "alpha" },
      { value: "2", label: "beta" },
    ]);
  });
});
