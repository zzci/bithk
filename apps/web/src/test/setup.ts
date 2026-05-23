import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
// Vitest setup for component/integration tests. Registers jest-dom matchers
// (the `/vitest` entry both extends `expect` and augments vitest's matcher
// types) and tears down the rendered tree after every test so suites stay
// isolated. Pure-logic suites (node-style) are unaffected — they simply never
// touch the DOM these globals provide.
import "@testing-library/jest-dom/vitest";

// jsdom ships no matchMedia; the theme provider probes it on mount. Provide a
// minimal stub (defaults to light) so components relying on it can render.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  cleanup();
});
