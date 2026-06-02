import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";
import { HttpError } from "./http";

describe("errorMessage", () => {
  it("hides the server message behind the fallback when the error carries a code", () => {
    const err = new HttpError("internal db row 42 missing", 422, "VALIDATION_ERROR");
    expect(errorMessage(err, "Something went wrong")).toBe("Something went wrong");
  });

  it("surfaces the raw message for code-less HttpError (proxy / non-JSON)", () => {
    const err = new HttpError("HTTP 500", 500);
    expect(errorMessage(err, "fallback")).toBe("HTTP 500");
  });

  it("surfaces the message of a plain Error", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("returns the fallback for non-Error values", () => {
    expect(errorMessage("just a string", "fallback")).toBe("fallback");
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
    expect(errorMessage({ message: "fake" }, "fallback")).toBe("fallback");
  });
});
