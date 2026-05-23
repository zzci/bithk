import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storageKey } from "@/shared/lib/branding";
import { ThemeProvider, useTheme } from "./theme-provider";

const KEY = storageKey("theme");

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  localStorage.clear();
});

describe("themeProvider", () => {
  it("defaults to system when nothing is stored", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("system");
  });

  it("reads the persisted theme on mount", () => {
    localStorage.setItem(KEY, "dark");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("persists and applies a theme change", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem(KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    act(() => result.current.setTheme("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("ignores an invalid stored value and falls back to system", () => {
    localStorage.setItem(KEY, "neon");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("system");
  });

  it("throws when useTheme is used outside the provider", () => {
    function Bare() {
      useTheme();
      return null;
    }
    expect(() => render(<Bare />)).toThrow("useTheme must be used within ThemeProvider");
  });

  it("renders children", () => {
    render(<ThemeProvider><span>child</span></ThemeProvider>);
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
