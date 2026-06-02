import { describe, expect, it } from "bun:test";
import { __resetPkceSecretForTests, openPkceVerifier, sealPkceVerifier } from "./pkce-secret";

// Flip the first hex character of one `:`-delimited segment so the value
// stays well-formed (4 parts, `v1:` scheme) but fails AEAD verification.
function tamperSegment(sealed: string, index: number): string {
  const parts = sealed.split(":");
  const seg = parts[index]!;
  parts[index] = (seg[0] === "a" ? "b" : "a") + seg.slice(1);
  return parts.join(":");
}

describe("pkce secret seal/open", () => {
  it("round-trips a verifier through seal → open", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(openPkceVerifier(sealPkceVerifier(verifier))).toBe(verifier);
  });

  it("emits the versioned 4-part storage format", () => {
    const sealed = sealPkceVerifier("verifier-abc");
    const parts = sealed.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("uses a fresh IV per seal yet both decrypt to the same plaintext", () => {
    const verifier = "same-input";
    const a = sealPkceVerifier(verifier);
    const b = sealPkceVerifier(verifier);
    expect(a).not.toBe(b);
    expect(openPkceVerifier(a)).toBe(verifier);
    expect(openPkceVerifier(b)).toBe(verifier);
  });

  it("returns undefined for a tampered ciphertext", () => {
    const sealed = sealPkceVerifier("verifier-1");
    expect(openPkceVerifier(tamperSegment(sealed, 2))).toBeUndefined();
  });

  it("returns undefined for a tampered auth tag", () => {
    const sealed = sealPkceVerifier("verifier-2");
    expect(openPkceVerifier(tamperSegment(sealed, 3))).toBeUndefined();
  });

  it("rejects a mismatched scheme version", () => {
    const sealed = sealPkceVerifier("verifier-3");
    expect(openPkceVerifier(sealed.replace(/^v1:/, "v2:"))).toBeUndefined();
  });

  it("rejects an input with the wrong segment count", () => {
    const sealed = sealPkceVerifier("verifier-4");
    expect(openPkceVerifier(`${sealed}:extra`)).toBeUndefined();
    expect(openPkceVerifier("v1:onlytwo")).toBeUndefined();
  });

  it("returns undefined for non-hex garbage", () => {
    expect(openPkceVerifier("v1:zz:zz:zz")).toBeUndefined();
  });

  it("invalidates in-flight verifiers once the cached key is reset", () => {
    const sealed = sealPkceVerifier("verifier-5");
    expect(openPkceVerifier(sealed)).toBe("verifier-5");

    __resetPkceSecretForTests();
    // The old ciphertext no longer authenticates under the regenerated key.
    expect(openPkceVerifier(sealed)).toBeUndefined();
    // …but a fresh seal/open round-trip still works under the new key.
    expect(openPkceVerifier(sealPkceVerifier("verifier-6"))).toBe("verifier-6");
  });
});
