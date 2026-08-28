// Parity guards between the web section registry and the API's copies.
//
// Two literals are duplicated across the app boundary on purpose: the web
// bundle cannot import the API module graph (its `@/` alias, drizzle schema and
// `AppDatabase` types all belong to the server), so the mirror is maintained by
// hand and defended here instead.
//
// The API sources are read as TEXT rather than imported for exactly that
// reason. The parse is deliberately strict: if either literal is reshaped the
// block simply stops matching and these tests fail loudly, which is the correct
// outcome — the mirror has to be re-checked by a human either way.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PROJECT_PRESETS } from "@/shared/lib/api/projects";
import { renderWithProviders } from "@/test/utils";
import { ProjectFormDialog } from "./-project-form-dialog";
import { CAPABILITY_SECTION, PROJECT_CORE_SECTION } from "./-project-sections";

// Concatenated rather than inlined as a literal on purpose: Vite rewrites the
// `new URL("<literal>", import.meta.url)` pattern into an asset reference, and
// the rewrite mangles the path. A computed specifier is left alone.
const API_PROJECT_DIR = "../../../../../../api/src/modules/project/";

function apiSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(API_PROJECT_DIR + relative, import.meta.url)), "utf8");
}

/** Body of a top-level `export const <name> = { … }` block, or "" if absent. */
function objectLiteralBody(source: string, name: string): string {
  return new RegExp(`^export const ${name}\\b[^={]*=\\s*\\{$([\\s\\S]*?)^\\}`, "m").exec(source)?.[1] ?? "";
}

/** Lines of a literal body that carry an entry (comments and blanks dropped). */
function entryLines(body: string): readonly string[] {
  return body.split("\n").map(line => line.trim()).filter(line => line !== "" && !line.startsWith("//"));
}

/** The API's `CAPABILITY_SECTION`, parsed out of `schema.ts`. */
function apiCapabilitySection(): Record<string, string> {
  const source = apiSource("schema.ts");
  // The core marker is a const reference in the literal, so resolve the API's
  // own value for it — hard-coding "core" here would mask a rename.
  const core = /^export const PROJECT_CORE_SECTION = "([\w-]+)";$/m.exec(source)?.[1] ?? "";
  expect(core, "apps/api schema.ts no longer exports a literal PROJECT_CORE_SECTION").not.toBe("");

  const map: Record<string, string> = {};
  for (const line of entryLines(objectLiteralBody(source, "CAPABILITY_SECTION"))) {
    const entry = /^"([\w.]+)":\s*(?:"([\w-]+)"|PROJECT_CORE_SECTION),$/.exec(line);
    expect(entry, `unparsable CAPABILITY_SECTION entry in apps/api schema.ts: ${line}`).not.toBeNull();
    map[entry![1]!] = entry![2] ?? core;
  }
  return map;
}

/** The API's `PROJECT_PRESETS`, parsed out of `section.registry.ts`. */
function apiProjectPresets(): Record<string, readonly string[]> {
  const presets: Record<string, readonly string[]> = {};
  for (const line of entryLines(objectLiteralBody(apiSource("section.registry.ts"), "PROJECT_PRESETS"))) {
    const entry = /^([\w-]+):\s*\[(.*)\],$/.exec(line);
    expect(entry, `unparsable PROJECT_PRESETS entry in apps/api section.registry.ts: ${line}`).not.toBeNull();
    presets[entry![1]!] = [...entry![2]!.matchAll(/"([\w-]+)"/g)].map(m => m[1]!);
  }
  return presets;
}

describe("cAPABILITY_SECTION mirrors the API", () => {
  const api = apiCapabilitySection();

  it("parsed the API map at all", () => {
    // Guards the guard: an empty parse would make every assertion below vacuous.
    expect(Object.keys(api).length).toBeGreaterThan(0);
  });

  it("carries exactly the API's capability keys", () => {
    expect(Object.keys(CAPABILITY_SECTION).toSorted()).toEqual(Object.keys(api).toSorted());
  });

  it("maps every capability to the API's section, value for value", () => {
    // Whole-object equality, so a single re-tagged capability (e.g. moving
    // categories.manage back to core) fails here rather than silently
    // regrouping the Roles editor.
    expect({ ...CAPABILITY_SECTION }).toEqual(api);
  });

  it("agrees with the API on the core pseudo-section marker", () => {
    const apiCore = /^export const PROJECT_CORE_SECTION = "([\w-]+)";$/m.exec(apiSource("schema.ts"))![1];
    expect(PROJECT_CORE_SECTION).toBe(apiCore);
  });
});

describe("pROJECT_PRESETS lockstep", () => {
  const api = apiProjectPresets();

  it("parsed the API presets at all", () => {
    expect(Object.keys(api).length).toBeGreaterThan(0);
  });

  it("offers exactly the API's preset keys", () => {
    expect(Object.keys(PROJECT_PRESETS).toSorted()).toEqual(Object.keys(api).toSorted());
  });

  it("mounts exactly the API's sections per preset, in the same order", () => {
    // Order matters: it is the projects' tab order on both sides.
    const web = Object.fromEntries(Object.entries(PROJECT_PRESETS).map(([key, sections]) => [key, [...sections]]));
    expect(web).toEqual(api);
  });

  it("renders one create-dialog option per preset", async () => {
    renderWithProviders(<ProjectFormDialog open onOpenChange={vi.fn()} pending={false} onSubmit={vi.fn()} />);
    // A preset added server-side must not leave the dialog stale.
    expect(screen.getAllByRole("radio")).toHaveLength(Object.keys(PROJECT_PRESETS).length);
  });

  it("submits each preset key from its own option", async () => {
    const submitted: unknown[] = [];
    // Selecting the nth option and submitting must yield the nth preset key;
    // reading them off the rendered options (rather than a hard-coded list)
    // keeps this honest as presets are added.
    for (let index = 0; index < Object.keys(PROJECT_PRESETS).length; index++) {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      const { unmount } = renderWithProviders(
        <ProjectFormDialog open onOpenChange={vi.fn()} pending={false} onSubmit={onSubmit} />,
      );
      await user.type(screen.getByLabelText("Name"), "Atlas");
      await user.click(screen.getAllByRole("radio")[index]!);
      await user.click(screen.getByRole("button", { name: "Create" }));
      submitted.push(onSubmit.mock.calls[0]![0].preset);
      unmount();
    }
    expect(submitted.toSorted()).toEqual(Object.keys(PROJECT_PRESETS).toSorted());
  });
});
