import { describe, expect, it } from "vitest";
import {
  ISSUE_STATUS_BADGE,
  PROCUREMENT_STATUS_BADGE,
  RECORD_STATUS_BADGE,
} from "./status-colors";

describe("status-colors", () => {
  it("maps active/archived record states to distinct classes", () => {
    expect(RECORD_STATUS_BADGE.active).toContain("text-success");
    expect(RECORD_STATUS_BADGE.archived).toContain("text-muted-foreground");
  });

  it("covers every issue status", () => {
    expect(Object.keys(ISSUE_STATUS_BADGE).sort()).toEqual(
      ["cancel", "done", "review", "todo", "working"],
    );
    for (const cls of Object.values(ISSUE_STATUS_BADGE))
      expect(cls).toMatch(/text-/);
  });

  it("covers every procurement status", () => {
    expect(Object.keys(PROCUREMENT_STATUS_BADGE).sort()).toEqual(
      ["accepted", "cancelled", "confirmed", "in_transit", "ordered", "paid", "received", "requested"],
    );
  });

  it("uses the solid token for the later state of a shared-hue phase", () => {
    // ordered (tint) vs in_transit (solid) both ride the info hue
    expect(PROCUREMENT_STATUS_BADGE.ordered).toBe("bg-info/10 text-info");
    expect(PROCUREMENT_STATUS_BADGE.in_transit).toBe("bg-info text-info-foreground");
    // received (tint) vs accepted (solid) both ride the success hue
    expect(PROCUREMENT_STATUS_BADGE.received).toBe("bg-success/10 text-success");
    expect(PROCUREMENT_STATUS_BADGE.accepted).toBe("bg-success text-success-foreground");
  });
});
