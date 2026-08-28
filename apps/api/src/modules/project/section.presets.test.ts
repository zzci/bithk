import { describe, expect, test } from "bun:test";
import { listRegisteredSections, PRESET_SECTION_KEYS, PROJECT_PRESETS } from "./section.registry";
// Side-effect imports: every module that owns a section registers it from its
// own barrel (ADR-009). This file is the ONLY place that names all of them, and
// deliberately so — it is the guard that a preset never mounts a section
// nothing implements.
import "@/modules/drive";
import "@/modules/issue";
import "@/modules/procurement";
import "@/modules/ship";

// Captured at module load, straight after the barrels above have registered.
// The registry is process-global and other test files reset it around their own
// stand-in sections, so reading it inside a test body would be order-dependent.
const registeredKeys = new Set(listRegisteredSections().map(def => def.key));

describe("preset completeness", () => {
  test("every key in every preset resolves to a registered section", () => {
    const missing: string[] = [];
    for (const [preset, keys] of Object.entries(PROJECT_PRESETS)) {
      for (const key of keys) {
        if (!registeredKeys.has(key))
          missing.push(`${preset}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("all six preset keys are covered — three built-in domains plus three maritime", () => {
    expect([...PRESET_SECTION_KEYS].sort()).toEqual([
      "equipment",
      "files",
      "issues",
      "procurement",
      "ship-profile",
      "worklist",
    ]);
    for (const key of PRESET_SECTION_KEYS)
      expect(registeredKeys.has(key)).toBe(true);
  });
});
