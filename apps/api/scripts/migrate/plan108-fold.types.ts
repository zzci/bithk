/**
 * Types shared by the PLAN-108 fold (DATA-003): the public report the CLI
 * prints and the test asserts on, plus the internal plan/context shapes the
 * planning pass and the per-table transforms exchange.
 */

/** One source row as `bun:sqlite` returns it: SQL column names, raw values. */
export type SourceRow = Record<string, unknown>;

export class FoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoldError";
  }
}

export interface FoldOptions {
  readonly from: string;
  readonly to: string;
  readonly force?: boolean;
}

export interface SkipGroup {
  readonly reason: string;
  readonly ids: readonly string[];
}

export interface TableReport {
  readonly table: string;
  /** `null` when the table does not exist in the source. */
  readonly source: number | null;
  /** Rows written into the same-named target table (verbatim + rewritten). */
  readonly written: number;
  /** Subset of `written` whose values changed. */
  readonly rewritten: number;
  readonly skipped: number;
  /** Rows carried into a differently named target table (`ships` -> `ship_profiles`). */
  readonly consumed: number;
  readonly skips: readonly SkipGroup[];
  readonly note: string;
}

export interface SkippedShip {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly deletedAt: string;
}

export interface NameMismatch {
  readonly shipId: string;
  readonly shipName: string;
  readonly projectId: string;
  readonly projectName: string;
}

export interface CoverOutcome {
  readonly refId: string;
  readonly fileId: string;
  readonly shipId: string;
  readonly projectId: string;
  /** Duplicate case: the `project_cover` row already holding (project, file). */
  readonly existingRefId?: string;
  /** Displaced case: the cover the project already carries. */
  readonly currentCoverId?: string;
}

export interface ModuleRewrite {
  readonly id: string;
  readonly before: string;
  readonly after: string;
}

export interface LocalBlob {
  readonly id: string;
  readonly sha256: string;
  readonly storageKey: string;
  readonly size: number;
}

export interface FoldReport {
  readonly from: string;
  readonly to: string;
  readonly sourceSha256Before: string;
  readonly sourceSha256After: string;
  readonly sourceJournalHash: string;
  readonly targetJournal: readonly string[];
  readonly ignoredSourceTables: readonly string[];
  /** Target tables outside the backup registry, copied verbatim after it. */
  readonly nonRegistryTables: readonly string[];
  readonly tables: readonly TableReport[];
  readonly ships: {
    readonly folded: number;
    readonly skipped: readonly SkippedShip[];
    readonly nameMismatches: readonly NameMismatch[];
    readonly descriptionsFilled: readonly string[];
  };
  readonly sections: {
    readonly rows: number;
    /** Projects carrying exactly the ship preset, measured on the target. */
    readonly shipProjects: number;
    /** Projects carrying exactly the general preset, measured on the target. */
    readonly generalProjects: number;
    /** Projects whose mounted list matches neither preset (expect none). */
    readonly other: readonly string[];
  };
  readonly parents: readonly { readonly projectId: string; readonly parentId: string }[];
  readonly parentsCleared: readonly { readonly projectId: string; readonly shipId: string }[];
  readonly covers: {
    readonly gained: readonly CoverOutcome[];
    readonly displaced: readonly CoverOutcome[];
    readonly notApplied: readonly CoverOutcome[];
    readonly retainedDuplicate: readonly CoverOutcome[];
    readonly retainedShipSkipped: readonly CoverOutcome[];
  };
  readonly tags: {
    readonly renamed: readonly { readonly id: string; readonly name: string }[];
    readonly merged: readonly { readonly id: string; readonly name: string; readonly into: string }[];
  };
  readonly modules: {
    readonly groups: readonly ModuleRewrite[];
    readonly groupsAfter: readonly { readonly id: string; readonly name: string; readonly modules: string }[];
    readonly defaultModules: ModuleRewrite | null;
    readonly defaultModulesAfter: string | null;
    readonly apiTokens: readonly ModuleRewrite[];
  };
  readonly localBlobs: readonly LocalBlob[];
  readonly selfCheck: {
    readonly journalBefore: readonly string[];
    readonly journalAfter: readonly string[];
    readonly mount: { readonly projects: number; readonly ships: number; readonly violations: number };
    readonly foreignKeyCheckRows: number;
    readonly integrityCheck: string;
    /** Size of a leftover `-wal` file after close; `null` when absent. */
    readonly walBytes: number | null;
  };
}

export interface TargetTable {
  readonly name: string;
  readonly columns: readonly string[];
}

export interface PlannedTable extends TargetTable {
  readonly rows: readonly SourceRow[];
  readonly report: TableReport;
}

/** Everything the planning pass collects, before the target exists. */
export interface PlanReport {
  ignoredSourceTables: string[];
  nonRegistryTables: string[];
  ships: {
    folded: number;
    skipped: SkippedShip[];
    nameMismatches: NameMismatch[];
    descriptionsFilled: string[];
  };
  parentsCleared: { projectId: string; shipId: string }[];
  covers: {
    gained: CoverOutcome[];
    displaced: CoverOutcome[];
    notApplied: CoverOutcome[];
    retainedDuplicate: CoverOutcome[];
    retainedShipSkipped: CoverOutcome[];
  };
  tags: {
    renamed: { id: string; name: string }[];
    merged: { id: string; name: string; into: string }[];
  };
  modules: {
    groups: ModuleRewrite[];
    defaultModules: ModuleRewrite | null;
    apiTokens: ModuleRewrite[];
  };
  localBlobs: LocalBlob[];
}

/** Cross-table decisions the transforms consume, computed once from the source. */
export interface FoldContext {
  readonly now: string;
  readonly projectsById: ReadonlyMap<string, SourceRow>;
  /** Ships that fold (a base project exists), by ship id. */
  readonly folded: ReadonlyMap<string, SourceRow>;
  /** The folded ship of a base project, by project id. */
  readonly byBase: ReadonlyMap<string, SourceRow>;
  /** `file_references.id` -> base project id for rewritten `ship_cover` rows. */
  readonly coverRewrite: ReadonlyMap<string, string>;
  /** Project id -> reference id it gains as cover. */
  readonly coverGain: ReadonlyMap<string, string>;
  /** Ship tag id -> surviving project tag id. */
  readonly tagMerge: ReadonlyMap<string, string>;
  readonly report: PlanReport;
}

export interface FoldPlan {
  readonly tables: readonly PlannedTable[];
  readonly report: PlanReport;
}

/** What one per-table transform returns: target-shaped rows plus its report line. */
export interface Transformed {
  readonly rows: SourceRow[];
  readonly rewritten: number;
  readonly skips: SkipGroup[];
  readonly consumed?: number;
  readonly note: string;
}
