/**
 * Per-table transforms of the PLAN-108 fold (DATA-003). Each takes the
 * source rows of one table plus the cross-table `FoldContext` and returns the
 * target-shaped rows with the table's report line. Tables without a case are
 * copied verbatim.
 */
import type { FoldContext, PlannedTable, SkipGroup, SourceRow, TargetTable, Transformed } from "./plan108-fold.types";
import { DEFAULT_MODULES_SETTING_KEY } from "@/modules/account/groups/module-gate";
import { PROJECT_PRESETS } from "@/modules/project/section.registry";
import { FoldError } from "./plan108-fold.types";

/**
 * Source column -> target column for the tables whose shape changed (fold
 * rules 3 and 6). Every other table must have an identical column set.
 */
export const COLUMN_MAP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  projects: { ship_id: "parent_id" },
  ship_equipment: { ship_id: "project_id" },
  ship_equipment_categories: { ship_id: "project_id" },
  worklists: { ship_id: "project_id" },
};

/** Mirrors `provisionSections`: mount rows get `i * 10` in preset order. */
const SORT_STEP = 10;

/** Maritime columns carried from `ships` to `ship_profiles` by name (rule 2). */
const SHIP_PROFILE_COLUMNS = [
  "model",
  "builder",
  "build_year",
  "length_overall",
  "beam",
  "draft",
  "air_draft",
  "gross_tonnage",
  "imo_number",
  "mmsi",
  "call_sign",
  "flag_state",
  "registry_port",
  "owner_name",
] as const;

const SCOPE_RANK: Readonly<Record<string, number>> = { read: 1, write: 2 };

export function text(row: SourceRow, col: string): string | null {
  const v = row[col];
  return v == null ? null : String(v);
}

export function requireText(row: SourceRow, col: string): string {
  const v = text(row, col);
  if (v === null)
    throw new FoldError(`unexpected NULL in column ${col}`);
  return v;
}

export function isBlank(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

function skipGroups(map: ReadonlyMap<string, string[]>): SkipGroup[] {
  return [...map].map(([reason, ids]) => ({ reason, ids }));
}

function addSkip(map: Map<string, string[]>, reason: string, id: string): void {
  const list = map.get(reason) ?? [];
  list.push(id);
  map.set(reason, list);
}

function remap(row: SourceRow, map: Readonly<Record<string, string>> | undefined): SourceRow {
  if (!map)
    return { ...row };
  const out: SourceRow = {};
  for (const [k, v] of Object.entries(row))
    out[map[k] ?? k] = v;
  return out;
}

/** Transform one target table and reconcile its row accounting; throws on unexplained loss. */
export function transformTable(target: TargetTable, rows: readonly SourceRow[] | undefined, ships: readonly SourceRow[], ctx: FoldContext): PlannedTable {
  const t = transformRows(target.name, rows, ships, ctx);
  for (const row of t.rows) {
    for (const col of target.columns) {
      if (!(col in row))
        throw new FoldError(`internal: ${target.name} row is missing column ${col}`);
    }
  }
  const source = rows ? rows.length : null;
  const skipped = t.skips.reduce((n, g) => n + g.ids.length, 0);
  const consumed = t.consumed ?? 0;
  if (source !== null && source - t.rows.length - skipped - consumed !== 0)
    throw new FoldError(`unexplained row loss on ${target.name}: source ${source}, written ${t.rows.length}, skipped ${skipped}`);
  return {
    ...target,
    rows: t.rows,
    report: {
      table: target.name,
      source,
      written: t.rows.length,
      rewritten: t.rewritten,
      skipped,
      consumed,
      skips: t.skips,
      note: t.note,
    },
  };
}

function transformRows(name: string, rows: readonly SourceRow[] | undefined, ships: readonly SourceRow[], ctx: FoldContext): Transformed {
  switch (name) {
    case "ship_profiles":
      return shipProfiles(ships, ctx);
    case "project_sections":
      return projectSections(ctx);
    case "projects":
      return projectsRows(rows ?? [], ctx);
    case "ship_equipment":
    case "ship_equipment_categories":
    case "worklists":
      return reparent(name, rows ?? [], ctx);
    case "tags":
      return tagsRows(rows ?? [], ctx);
    case "tags_refs":
      return tagRefsRows(rows ?? [], ctx);
    case "file_references":
      return fileReferencesRows(rows ?? [], ctx);
    case "groups":
      return groupsRows(rows ?? [], ctx);
    case "settings":
      return settingsRows(rows ?? [], ctx);
    case "api_tokens":
      return apiTokensRows(rows ?? [], ctx);
    default:
      return { rows: rows ? rows.map(r => ({ ...r })) : [], rewritten: 0, skips: [], note: rows ? "verbatim" : "not in source" };
  }
}

function shipProfiles(ships: readonly SourceRow[], ctx: FoldContext): Transformed {
  const rows: SourceRow[] = [];
  for (const ship of ships) {
    if (!ctx.folded.has(requireText(ship, "id")))
      continue;
    const row: SourceRow = {
      project_id: requireText(ship, "base_project_id"),
      hull_number: requireText(ship, "code"),
      ship_status: requireText(ship, "status"),
    };
    for (const col of SHIP_PROFILE_COLUMNS)
      row[col] = ship[col] ?? null;
    row.created_at = requireText(ship, "updated_at");
    row.updated_at = requireText(ship, "updated_at");
    rows.push(row);
  }
  return { rows, rewritten: 0, skips: [], note: "generated from ships (rule 2)" };
}

function projectSections(ctx: FoldContext): Transformed {
  const rows: SourceRow[] = [];
  for (const projectId of ctx.projectsById.keys()) {
    const preset = ctx.byBase.has(projectId) ? "ship" : "general";
    PROJECT_PRESETS[preset].forEach((key, i) => {
      rows.push({ project_id: projectId, key, sort_order: i * SORT_STEP, created_at: ctx.now });
    });
  }
  return { rows, rewritten: 0, skips: [], note: "generated: general preset for every project, ship preset for folded bases (rule 1)" };
}

function projectsRows(rows: readonly SourceRow[], ctx: FoldContext): Transformed {
  let rewritten = 0;
  const out = rows.map((p) => {
    const id = requireText(p, "id");
    const row = remap(p, COLUMN_MAP.projects);
    const shipId = text(p, "ship_id");
    let parent: string | null = null;
    if (shipId !== null) {
      const ship = ctx.folded.get(shipId);
      if (ship) {
        const base = requireText(ship, "base_project_id");
        parent = base === id ? null : base;
      }
      else {
        ctx.report.parentsCleared.push({ projectId: id, shipId });
      }
    }
    row.parent_id = parent;
    let changed = parent !== null;
    const ship = ctx.byBase.get(id);
    if (ship && isBlank(p.description) && !isBlank(ship.description)) {
      row.description = ship.description;
      ctx.report.ships.descriptionsFilled.push(id);
      changed = true;
    }
    const gained = ctx.coverGain.get(id);
    if (gained !== undefined) {
      row.cover_reference_id = gained;
      changed = true;
    }
    if (changed)
      rewritten++;
    return row;
  });
  return { rows: out, rewritten, skips: [], note: "ship_id dropped on every row; parent_id / description / cover per rules 2, 5, 6" };
}

function reparent(name: string, rows: readonly SourceRow[], ctx: FoldContext): Transformed {
  const errors: string[] = [];
  let rewritten = 0;
  const out = rows.map((r) => {
    const row = remap(r, COLUMN_MAP[name]);
    const shipId = text(r, "ship_id");
    if (shipId === null) {
      row.project_id = null;
      return row;
    }
    const ship = ctx.folded.get(shipId);
    if (!ship) {
      errors.push(`${requireText(r, "id")} -> ship ${shipId}`);
      return row;
    }
    row.project_id = requireText(ship, "base_project_id");
    rewritten++;
    return row;
  });
  if (errors.length > 0)
    throw new FoldError(`${name} rows point at a skipped or unknown ship:\n  - ${errors.join("\n  - ")}`);
  return { rows: out, rewritten, skips: [], note: "ship_id -> project_id (rule 3)" };
}

function tagsRows(rows: readonly SourceRow[], ctx: FoldContext): Transformed {
  const skips = new Map<string, string[]>();
  let rewritten = 0;
  const out: SourceRow[] = [];
  for (const tag of rows) {
    const id = requireText(tag, "id");
    if (text(tag, "type") !== "ship") {
      out.push({ ...tag });
      continue;
    }
    const into = ctx.tagMerge.get(id);
    if (into !== undefined) {
      addSkip(skips, `merged into project tag ${into}`, id);
      continue;
    }
    out.push({ ...tag, type: "project" });
    rewritten++;
  }
  return { rows: out, rewritten, skips: skipGroups(skips), note: "type ship -> project, merged into a same-named project tag (rule 4)" };
}

function tagRefsRows(rows: readonly SourceRow[], ctx: FoldContext): Transformed {
  const shipTagIds = new Set([...ctx.report.tags.renamed.map(t => t.id), ...ctx.tagMerge.keys()]);
  const seen = new Set<string>();
  const keyOf = (resourceId: string, tagId: string): string => `${resourceId} ${tagId}`;
  for (const ref of rows) {
    if (!shipTagIds.has(requireText(ref, "tag_id")))
      seen.add(keyOf(requireText(ref, "resource_id"), requireText(ref, "tag_id")));
  }
  const skips = new Map<string, string[]>();
  let rewritten = 0;
  const out: SourceRow[] = [];
  for (const ref of rows) {
    const tagId = requireText(ref, "tag_id");
    const resourceId = requireText(ref, "resource_id");
    if (!shipTagIds.has(tagId)) {
      out.push({ ...ref });
      continue;
    }
    const ship = ctx.folded.get(resourceId);
    if (!ship) {
      addSkip(skips, "ship was skipped or unknown", `${resourceId}/${tagId}`);
      continue;
    }
    const newTag = ctx.tagMerge.get(tagId) ?? tagId;
    const newResource = requireText(ship, "base_project_id");
    const key = keyOf(newResource, newTag);
    if (seen.has(key)) {
      addSkip(skips, `duplicate of (${newResource}, ${newTag})`, `${resourceId}/${tagId}`);
      continue;
    }
    seen.add(key);
    out.push({ resource_id: newResource, tag_id: newTag });
    rewritten++;
  }
  return { rows: out, rewritten, skips: skipGroups(skips), note: "ship id -> base project id, de-duplicated (rule 4)" };
}

function fileReferencesRows(rows: readonly SourceRow[], ctx: FoldContext): Transformed {
  let rewritten = 0;
  const out = rows.map((ref) => {
    const projectId = ctx.coverRewrite.get(requireText(ref, "id"));
    if (projectId === undefined)
      return { ...ref };
    rewritten++;
    return { ...ref, owner_type: "project_cover", owner_id: projectId };
  });
  const retained = ctx.report.covers.retainedDuplicate.length + ctx.report.covers.retainedShipSkipped.length;
  return { rows: out, rewritten, skips: [], note: `ship_cover -> project_cover (rule 5); ${retained} retained verbatim` };
}

/** Rewrite a JSON module list: `ships` becomes `projects`, merged when already present. */
export function rewriteModuleList(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  }
  catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.includes("ships"))
    return null;
  const next = parsed.includes("projects")
    ? parsed.filter(m => m !== "ships")
    : parsed.map(m => (m === "ships" ? "projects" : m));
  return JSON.stringify(next);
}

/** Rewrite a JSON scope object: the `ships` key becomes `projects`, keeping the higher level. */
export function rewriteScopes(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  }
  catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return null;
  const scopes = parsed as Record<string, unknown>;
  if (!("ships" in scopes))
    return null;
  const higher = (a: unknown, b: unknown): unknown =>
    (SCOPE_RANK[String(a)] ?? 0) >= (SCOPE_RANK[String(b)] ?? 0) ? a : b;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scopes)) {
    if (key === "ships") {
      if (!("projects" in next))
        next.projects = "projects" in scopes ? higher(scopes.projects, value) : value;
    }
    else if (key === "projects") {
      next.projects = higher(value, scopes.ships);
    }
    else {
      next[key] = value;
    }
  }
  return JSON.stringify(next);
}

function groupsRows(rows: readonly SourceRow[], ctx: FoldContext): Transformed {
  let rewritten = 0;
  const out = rows.map((g) => {
    const before = requireText(g, "modules");
    const after = rewriteModuleList(before);
    if (after === null)
      return { ...g };
    rewritten++;
    ctx.report.modules.groups.push({ id: requireText(g, "id"), before, after });
    return { ...g, modules: after };
  });
  return { rows: out, rewritten, skips: [], note: "modules: ships -> projects, merged (rule 7)" };
}

function settingsRows(rows: readonly SourceRow[], ctx: FoldContext): Transformed {
  let rewritten = 0;
  const out = rows.map((s) => {
    if (text(s, "key") !== DEFAULT_MODULES_SETTING_KEY)
      return { ...s };
    const before = requireText(s, "value");
    const after = rewriteModuleList(before);
    if (after === null)
      return { ...s };
    rewritten++;
    ctx.report.modules.defaultModules = { id: DEFAULT_MODULES_SETTING_KEY, before, after };
    return { ...s, value: after };
  });
  return { rows: out, rewritten, skips: [], note: `${DEFAULT_MODULES_SETTING_KEY}: ships -> projects, merged (rule 7)` };
}

function apiTokensRows(rows: readonly SourceRow[], ctx: FoldContext): Transformed {
  let rewritten = 0;
  const out = rows.map((tok) => {
    const before = requireText(tok, "scopes");
    const after = rewriteScopes(before);
    if (after === null)
      return { ...tok };
    rewritten++;
    ctx.report.modules.apiTokens.push({ id: requireText(tok, "id"), before, after });
    return { ...tok, scopes: after };
  });
  return { rows: out, rewritten, skips: [], note: "scopes: ships -> projects, higher level wins (rule 7)" };
}
