import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storageKey } from "@/shared/lib/branding";
import { renderWithProviders } from "@/test/utils";
import { ModeToggle } from "./mode-toggle";

const KEY = storageKey("theme");

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  localStorage.clear();
});

describe("modeToggle", () => {
  it("starts from the system theme and advertises the next step in its label", () => {
    renderWithProviders(<ModeToggle />);
    expect(screen.getByRole("button", { name: "Theme: system, switch to light" })).toBeInTheDocument();
  });

  it("cycles system -> light -> dark -> system and drives the dark class on click", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ModeToggle />);

    // system -> light
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Theme: light, switch to dark" })).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("light");

    // light -> dark (dual-channel theming applies the `dark` class to <html>)
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Theme: dark, switch to system" })).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("dark");

    // dark -> system (matchMedia stub reports light, so the class is cleared)
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Theme: system, switch to light" })).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
