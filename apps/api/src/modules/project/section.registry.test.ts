import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CAPABILITY_SECTION, PROJECT_CAPABILITIES, PROJECT_CORE_SECTION } from "./schema";
import {
  DEFAULT_PROJECT_PRESET,
  getProjectSection,
  listRegisteredSections,
  PRESET_SECTION_KEYS,
  PROJECT_PRESETS,
  registerProjectSection,
  resetProjectSectionRegistry,
} from "./section.registry";

// The section registry is process-global and module barrels register into it
// once per process, so a test that installs its own sections must put the real
// ones back for the test files that run after it (same convention as
// `search.registry.test.ts`).
const realSections = listRegisteredSections();

function restoreProjectSections(): void {
  resetProjectSectionRegistry();
  for (const def of realSections)
    registerProjectSection(def);
}

beforeEach(() => {
  resetProjectSectionRegistry();
});

afterEach(() => {
  restoreProjectSections();
});

describe("presets", () => {
  test("general mounts the three core domains, in tab order", () => {
    expect(PROJECT_PRESETS.general).toEqual(["issues", "procurement", "files"]);
  });

  test("ship extends general with the three maritime sections", () => {
    expect(PROJECT_PRESETS.ship).toEqual([
      "issues",
      "procurement",
      "files",
      "ship-profile",
      "equipment",
      "worklist",
    ]);
  });

  test("the default preset is general", () => {
    expect(DEFAULT_PROJECT_PRESET).toBe("general");
  });

  test("PRESET_SECTION_KEYS is the deduplicated union of every preset", () => {
    expect([...PRESET_SECTION_KEYS].sort()).toEqual([
      "equipment",
      "files",
      "issues",
      "procurement",
      "ship-profile",
      "worklist",
    ]);
  });
});

describe("registerProjectSection", () => {
  test("registers a section and makes it retrievable by key", () => {
    const def = { key: "issues", capabilities: ["issue.view"] } as const;
    registerProjectSection(def);

    expect(getProjectSection("issues")).toBe(def);
    expect(listRegisteredSections()).toEqual([def]);
  });

  test("returns undefined for an unregistered key", () => {
    expect(getProjectSection("equipment")).toBeUndefined();
  });

  test("throws on a duplicate key", () => {
    registerProjectSection({ key: "files" });
    expect(() => registerProjectSection({ key: "files" })).toThrow(/already registered/);
  });

  test("lists sections in registration order", () => {
    registerProjectSection({ key: "procurement" });
    registerProjectSection({ key: "files" });
    registerProjectSection({ key: "issues" });

    expect(listRegisteredSections().map(d => d.key)).toEqual(["procurement", "files", "issues"]);
  });
});

describe("CAPABILITY_SECTION", () => {
  test("tags every capability with a section", () => {
    for (const cap of PROJECT_CAPABILITIES)
      expect(typeof CAPABILITY_SECTION[cap]).toBe("string");
    expect(Object.keys(CAPABILITY_SECTION).sort()).toEqual([...PROJECT_CAPABILITIES].sort());
  });

  test("maps each capability group to its owning section", () => {
    expect(CAPABILITY_SECTION["issue.view"]).toBe("issues");
    expect(CAPABILITY_SECTION["issue.comment"]).toBe("issues");
    expect(CAPABILITY_SECTION["issue.manage"]).toBe("issues");
    expect(CAPABILITY_SECTION["procurement.view"]).toBe("procurement");
    expect(CAPABILITY_SECTION["procurement.comment"]).toBe("procurement");
    expect(CAPABILITY_SECTION["procurement.manage"]).toBe("procurement");
    expect(CAPABILITY_SECTION["files.view"]).toBe("files");
    expect(CAPABILITY_SECTION["files.manage"]).toBe("files");
    // Procurement categories are procurement-domain data.
    expect(CAPABILITY_SECTION["categories.manage"]).toBe("procurement");
  });

  test("keeps the project-admin capabilities on the core record", () => {
    expect(CAPABILITY_SECTION["members.manage"]).toBe(PROJECT_CORE_SECTION);
    expect(CAPABILITY_SECTION["roles.manage"]).toBe(PROJECT_CORE_SECTION);
    expect(CAPABILITY_SECTION["project.manage"]).toBe(PROJECT_CORE_SECTION);
  });

  test("every non-core section it names is a real preset key", () => {
    for (const section of Object.values(CAPABILITY_SECTION)) {
      if (section !== PROJECT_CORE_SECTION)
        expect(PRESET_SECTION_KEYS).toContain(section);
    }
  });
});
