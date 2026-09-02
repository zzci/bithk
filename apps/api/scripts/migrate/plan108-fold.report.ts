/**
 * Plain-text rendering of a `FoldReport` (DATA-003). Kept apart from the fold
 * so the test can assert on the structured report and the CLI on the text.
 * Setting VALUES are never printed except `account.default_modules`; the
 * `storage.s3.*` rows carry a secret.
 */
import type { CoverOutcome, FoldReport, TableReport } from "./plan108-fold.types";

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function list<T>(items: readonly T[], render: (item: T) => string): string[] {
  return items.length === 0 ? ["  (none)"] : items.map(i => `  - ${render(i)}`);
}

function cover(c: CoverOutcome): string {
  const base = `ref ${c.refId} (file ${c.fileId}, ship ${c.shipId}) -> project ${c.projectId || "(none)"}`;
  if (c.existingRefId)
    return `${base}: duplicate of project_cover ${c.existingRefId}`;
  if (c.currentCoverId)
    return `${base}: project already carries cover ${c.currentCoverId}`;
  return base;
}

function tableLine(t: TableReport): string[] {
  const source = t.source === null ? "-" : t.source;
  const out = [
    `${pad(t.table, 30)} ${pad(source, 7)} ${pad(t.written, 8)} ${pad(t.rewritten, 10)} ${pad(t.skipped, 8)} ${pad(t.consumed, 9)} ${t.note}`,
  ];
  for (const skip of t.skips)
    out.push(`${" ".repeat(32)}skipped (${skip.ids.length}) ${skip.reason}: ${skip.ids.join(", ")}`);
  return out;
}

export function formatFoldReport(r: FoldReport): string {
  const lines: string[] = [];
  lines.push("PLAN-108 fold report (DATA-003)");
  lines.push(`source: ${r.from}`);
  lines.push(`  sha256 before: ${r.sourceSha256Before}`);
  lines.push(`  sha256 after:  ${r.sourceSha256After}${r.sourceSha256After === r.sourceSha256Before ? " (unchanged)" : " (CHANGED)"}`);
  lines.push(`  journal: 1 row, hash ${r.sourceJournalHash} (pre-fold baseline)`);
  lines.push(`target: ${r.to}`);
  lines.push(`  journal: ${r.targetJournal.length} row(s) written by migrate(): ${r.targetJournal.join(", ")}`);
  lines.push(`  source tables ignored: ${r.ignoredSourceTables.join(", ") || "(none)"}`);
  lines.push(`  target tables outside the backup registry (copied verbatim after it): ${r.nonRegistryTables.join(", ") || "(none)"}`);

  lines.push("");
  lines.push("== Tables (write order) ==");
  lines.push(`${pad("table", 30)} ${pad("source", 7)} ${pad("written", 8)} ${pad("rewritten", 10)} ${pad("skipped", 8)} ${pad("consumed", 9)} note`);
  for (const t of r.tables)
    lines.push(...tableLine(t));
  const sourceRows = r.tables.reduce((n, t) => n + (t.source ?? 0), 0);
  const writtenRows = r.tables.reduce((n, t) => n + t.written, 0);
  lines.push(`totals: source ${sourceRows} rows (ships counted under consumed), written ${writtenRows} rows`);

  lines.push("");
  lines.push("== Ships (rule 2) ==");
  lines.push(`folded into ship_profiles: ${r.ships.folded}`);
  lines.push(`skipped soft-deleted ships without a base project (${r.ships.skipped.length}):`);
  lines.push(...list(r.ships.skipped, s => `${s.id} code=${s.code} name="${s.name}" deleted_at=${s.deletedAt}`));
  lines.push(`ship/project name mismatches (${r.ships.nameMismatches.length}, project name kept):`);
  lines.push(...list(r.ships.nameMismatches, m => `ship ${m.shipId} "${m.shipName}" vs project ${m.projectId} "${m.projectName}"`));
  lines.push(`project descriptions filled from the ship (${r.ships.descriptionsFilled.length}): ${r.ships.descriptionsFilled.join(", ") || "(none)"}`);

  lines.push("");
  lines.push("== Spot checks (measured on the target) ==");
  lines.push(`ship_profiles rows: ${r.tables.find(t => t.table === "ship_profiles")?.written ?? 0}`);
  lines.push(`project_sections rows: ${r.sections.rows}`);
  lines.push(`projects carrying all six ship sections in order: ${r.sections.shipProjects}`);
  lines.push(`projects carrying exactly the three general sections: ${r.sections.generalProjects}`);
  lines.push(`projects matching neither preset (${r.sections.other.length}): ${r.sections.other.join("; ") || "(none)"}`);
  lines.push(`projects with parent_id (${r.parents.length}):`);
  lines.push(...list(r.parents, p => `${p.projectId} -> parent ${p.parentId}`));
  lines.push(`projects whose ship link was cleared because the ship was skipped (${r.parentsCleared.length}):`);
  lines.push(...list(r.parentsCleared, p => `${p.projectId} (ship ${p.shipId})`));
  lines.push(`covers gained (${r.covers.gained.length}):`);
  lines.push(...list(r.covers.gained, cover));
  lines.push(`covers displaced, rewritten but not applied (${r.covers.displaced.length}):`);
  lines.push(...list(r.covers.displaced, cover));
  lines.push(`covers rewritten but not applied, project gained another (${r.covers.notApplied.length}):`);
  lines.push(...list(r.covers.notApplied, cover));
  lines.push(`covers retained verbatim, duplicate of an existing project_cover (${r.covers.retainedDuplicate.length}):`);
  lines.push(...list(r.covers.retainedDuplicate, cover));
  lines.push(`covers retained verbatim, ship skipped (${r.covers.retainedShipSkipped.length}):`);
  lines.push(...list(r.covers.retainedShipSkipped, cover));
  lines.push(`ship tags renamed to project (${r.tags.renamed.length}): ${r.tags.renamed.map(t => `${t.id} "${t.name}"`).join(", ") || "(none)"}`);
  lines.push(`ship tags merged into an existing project tag (${r.tags.merged.length}): ${r.tags.merged.map(t => `${t.id} "${t.name}" -> ${t.into}`).join(", ") || "(none)"}`);
  lines.push(`groups.modules rewritten (${r.modules.groups.length}):`);
  lines.push(...list(r.modules.groups, g => `${g.id}: ${g.before} -> ${g.after}`));
  lines.push("groups after the fold:");
  lines.push(...list(r.modules.groupsAfter, g => `${g.id} "${g.name}": ${g.modules}`));
  lines.push(`account.default_modules: ${r.modules.defaultModules ? `${r.modules.defaultModules.before} -> ${r.modules.defaultModules.after}` : "not rewritten"}; after the fold: ${r.modules.defaultModulesAfter ?? "(absent)"}`);
  lines.push(`api_tokens.scopes rewritten (${r.modules.apiTokens.length}):`);
  lines.push(...list(r.modules.apiTokens, t => `${t.id}: ${t.before} -> ${t.after}`));

  lines.push("");
  lines.push(`== Local blobs (${r.localBlobs.length}) -- NOT verified, dangling on this machine ==`);
  lines.push(...list(r.localBlobs, b => `${b.id} sha256=${b.sha256} storage_key=${b.storageKey} size=${b.size}`));

  lines.push("");
  lines.push("== Post-fold self-check ==");
  const journalSame = r.selfCheck.journalBefore.length === r.selfCheck.journalAfter.length
    && r.selfCheck.journalBefore.at(-1) === r.selfCheck.journalAfter.at(-1);
  lines.push(`migrate() on reopen: ${journalSame ? "no-op" : "APPLIED CHANGES"} (journal ${r.selfCheck.journalBefore.length} -> ${r.selfCheck.journalAfter.length} rows, last hash ${r.selfCheck.journalAfter.at(-1) ?? "(none)"})`);
  lines.push(`checkMountIntegrity: projects=${r.selfCheck.mount.projects} ships=${r.selfCheck.mount.ships} violations=${r.selfCheck.mount.violations}`);
  lines.push(`foreign_key_check: ${r.selfCheck.foreignKeyCheckRows} row(s)`);
  lines.push(`integrity_check: ${r.selfCheck.integrityCheck}`);
  lines.push(`leftover -wal: ${r.selfCheck.walBytes === null ? "absent" : `${r.selfCheck.walBytes} bytes`}`);
  lines.push("");
  lines.push("FOLD OK");
  return lines.join("\n");
}
