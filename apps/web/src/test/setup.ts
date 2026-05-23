import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
// Shared Vitest setup for the web workspace. Loaded via `setupFiles` for every
// test (see vitest.config.ts). It does three things, all of them reusable by
// any web test lane:
//   1. registers jest-dom matchers (the `/vitest` entry also augments vitest's
//      matcher types, so `toBeInTheDocument()` etc. are typed);
//   2. installs the browser-API polyfills jsdom omits but shadcn/@base-ui
//      components probe on mount (matchMedia, ResizeObserver,
//      IntersectionObserver, scrollIntoView, PointerEvent capture);
//   3. tears down the rendered tree after every test so suites stay isolated.
// Pure-logic suites (node-style) are unaffected — they never touch the DOM
// these globals provide.
import "@testing-library/jest-dom/vitest";

// jsdom ships no matchMedia; the theme provider probes it on mount. Default to
// the light scheme and accept (and ignore) listeners.
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

// ResizeObserver / IntersectionObserver are used by virtualised lists, popovers
// and sticky UI; jsdom provides neither. Minimal no-op stubs keep components
// mountable without faking layout.
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

if (!globalThis.ResizeObserver)
  globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
if (!globalThis.IntersectionObserver)
  globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;

// jsdom does not implement layout, so scrollIntoView is absent; menus/selects
// call it when moving the active item.
if (!Element.prototype.scrollIntoView)
  Element.prototype.scrollIntoView = vi.fn();

// @base-ui / Radix-style primitives use Pointer Events capture APIs that jsdom
// only partially implements. Stub the capture methods so popovers, selects and
// dialogs can open under user-event without throwing.
if (!Element.prototype.hasPointerCapture)
  Element.prototype.hasPointerCapture = vi.fn(() => false);
if (!Element.prototype.setPointerCapture)
  Element.prototype.setPointerCapture = vi.fn();
if (!Element.prototype.releasePointerCapture)
  Element.prototype.releasePointerCapture = vi.fn();

afterEach(() => {
  cleanup();
});
