// Backup v2 (PLAN-075 R5/R7) — shared API view types + the report renderer
// used for both the dry-run report (upload response / `validated` poll) and
// the final apply result, plus the standalone blob-restore report. The two
// report flavours differ only in their `blobs` shape (existence-check counts
// vs the apply stage's written/skipped/failed counters) — detected by field.
import type { TFunction } from "i18next";
import type { BlobRestoreReport, ImportReport, ImportTableReport } from "@/shared/lib/api/backup";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

// ─── API view types ────────────────────────────────────────────────────────
//
// The backup view types moved to the shared data layer
// (`@/shared/lib/api/backup`); re-exported here for the sibling backup tab
// files that historically imported them from this module.

export type {
  ApplyBlobCounts,
  BackupModuleView,
  BlobRestoreReport,
  BlobsMode,
  DryRunBlobCounts,
  ExportArtifactView,
  ExportJobView,
  ImportFailedRow,
  ImportJobView,
  ImportReport,
  ImportTableReport,
} from "@/shared/lib/api/backup";

// ─── Reason vocabulary → translated labels ────────────────────────────────

const RE_UNIQUE_CONFLICT = /^unique-conflict\((.+)\)$/;
const MISSING_REQUIRED_PREFIX = "missing-required-column";

function reasonLabel(t: TFunction<"settings">, reason: string): string {
  if (reason === "missing-parent")
    return t("backup.report.reasons.missingParent");
  const unique = RE_UNIQUE_CONFLICT.exec(reason);
  if (unique)
    return t("backup.report.reasons.uniqueConflict", { index: unique[1] });
  if (reason.startsWith(MISSING_REQUIRED_PREFIX))
    return `${t("backup.report.reasons.missingRequiredColumn")}${reason.slice(MISSING_REQUIRED_PREFIX.length)}`;
  return reason;
}

// ─── Building blocks ──────────────────────────────────────────────────────

function SummaryStat({ label, value, tone }: {
  readonly label: string;
  readonly value: number;
  readonly tone?: "destructive";
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={tone === "destructive" && value > 0 ? "mt-1 text-lg font-semibold text-destructive" : "mt-1 text-lg font-semibold"}>
        {value}
      </div>
    </div>
  );
}

function CountList({ title, rows }: {
  readonly title: string;
  readonly rows: readonly { readonly label: string; readonly value: number }[];
}) {
  return (
    <div className="rounded-lg border">
      <div className="border-b px-3 py-2 text-sm font-medium">{title}</div>
      <div className="divide-y">
        {rows.map(row => (
          <div key={row.label} className="grid gap-1 px-3 py-1.5 text-sm sm:grid-cols-[16rem_1fr]">
            <div className="text-muted-foreground">{row.label}</div>
            <div className="tabular-nums">{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NameList({ title, items }: { readonly title: string; readonly items: readonly string[] }) {
  if (items.length === 0)
    return null;
  return (
    <div className="rounded-lg border">
      <div className="border-b px-3 py-2 text-sm font-medium">{title}</div>
      <ul className="space-y-1 px-3 py-2 text-sm text-muted-foreground">
        {items.map(item => <li key={item} className="break-words">{item}</li>)}
      </ul>
    </div>
  );
}

function columnCounts(record: Record<string, number>): string {
  return Object.entries(record).map(([col, n]) => `${col} (${n})`).join(", ");
}

// ─── Per-table detail table with expandable rows ──────────────────────────

function hasDetail(report: ImportTableReport): boolean {
  return Object.keys(report.droppedColumns).length > 0
    || Object.keys(report.defaultedColumns).length > 0
    || report.failed.sample.length > 0
    || report.error !== undefined
    || report.noKeyAppend === true;
}

function TableDetail({ name, report }: { readonly name: string; readonly report: ImportTableReport }) {
  const { t } = useTranslation("settings");
  return (
    <div className="space-y-2 py-1 text-sm whitespace-normal">
      {report.error !== undefined && (
        <p className="text-destructive">
          {`${t("backup.report.tableError")}: ${reasonLabel(t, report.error)}`}
        </p>
      )}
      {report.noKeyAppend === true && (
        <p className="text-muted-foreground">{t("backup.report.noKeyAppend")}</p>
      )}
      {Object.keys(report.droppedColumns).length > 0 && (
        <p>
          <span className="text-muted-foreground">{`${t("backup.report.droppedColumns")}: `}</span>
          <span className="font-mono text-xs">{columnCounts(report.droppedColumns)}</span>
        </p>
      )}
      {Object.keys(report.defaultedColumns).length > 0 && (
        <p>
          <span className="text-muted-foreground">{`${t("backup.report.defaultedColumns")}: `}</span>
          <span className="font-mono text-xs">{columnCounts(report.defaultedColumns)}</span>
        </p>
      )}
      {report.failed.sample.length > 0 && (
        <div>
          <div className="text-muted-foreground">{`${t("backup.report.failureSample")} (${report.failed.sample.length}/${report.failed.total}):`}</div>
          <ul className="mt-1 space-y-0.5">
            {report.failed.sample.map(row => (
              <li key={`${name}-${row.rowId}`} className="break-words">
                <span className="font-mono text-xs">{row.rowId}</span>
                {` — ${reasonLabel(t, row.reason)}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PerTableReport({ tables }: { readonly tables: Record<string, ImportTableReport> }) {
  const { t } = useTranslation("settings");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name))
        next.delete(name);
      else
        next.add(name);
      return next;
    });
  };

  const names = Object.keys(tables);
  if (names.length === 0)
    return null;

  return (
    <div className="rounded-lg border">
      <div className="border-b px-3 py-2 text-sm font-medium">{t("backup.report.tables")}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("backup.report.colTable")}</TableHead>
            <TableHead className="text-right">{t("backup.report.colInserted")}</TableHead>
            <TableHead className="text-right">{t("backup.report.colDuplicates")}</TableHead>
            <TableHead className="text-right">{t("backup.report.colFailed")}</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {names.map((name) => {
            const report = tables[name]!;
            const isOpen = expanded.has(name);
            return (
              <Fragment key={name}>
                <TableRow>
                  <TableCell className="font-mono text-xs">{name}</TableCell>
                  <TableCell className="text-right tabular-nums">{report.inserted}</TableCell>
                  <TableCell className="text-right tabular-nums">{report.skippedDuplicate}</TableCell>
                  <TableCell className={report.failed.total > 0 || report.error !== undefined ? "text-right font-medium text-destructive tabular-nums" : "text-right tabular-nums"}>
                    {report.failed.total}
                  </TableCell>
                  <TableCell className="text-right">
                    {hasDetail(report) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-expanded={isOpen}
                        onClick={() => toggle(name)}
                      >
                        {isOpen ? t("backup.report.hideDetail") : t("backup.report.showDetail")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <TableDetail name={name} report={report} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Report views ─────────────────────────────────────────────────────────

export function ImportReportView({ title, report }: {
  readonly title: string;
  readonly report: ImportReport;
}) {
  const { t } = useTranslation("settings");
  const blobs = report.blobs;
  const blobRows = "written" in blobs
    ? [
        { label: t("backup.report.blobsWritten"), value: blobs.written },
        { label: t("backup.report.blobsSkippedExisting"), value: blobs.skippedExisting },
        { label: t("backup.report.blobsFailed"), value: blobs.failed },
        { label: t("backup.report.blobsUnreferenced"), value: blobs.unreferenced },
        { label: t("backup.report.blobsMissing"), value: blobs.missing },
        { label: t("backup.report.blobsExpectedSeparate"), value: blobs.expectedInSeparateArchive },
      ]
    : [
        { label: t("backup.report.blobsCount"), value: blobs.count },
        { label: t("backup.report.blobsExisting"), value: blobs.existing },
        { label: t("backup.report.blobsMissing"), value: blobs.missing },
      ];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat
          label={report.dryRun ? t("backup.report.toInsert") : t("backup.report.inserted")}
          value={report.totals.inserted}
        />
        <SummaryStat
          label={report.dryRun ? t("backup.report.duplicatesToSkip") : t("backup.report.duplicatesSkipped")}
          value={report.totals.skippedDuplicate}
        />
        <SummaryStat label={t("backup.report.failures")} value={report.totals.failed} tone="destructive" />
        <SummaryStat label={t("backup.report.transformed")} value={report.totals.transformed} />
      </div>

      {"wipe" in report && report.wipe && (
        <p className="text-sm text-destructive">
          {t("backup.report.wipeSummary", { total: report.wipe.total })}
        </p>
      )}

      {"replace" in report && report.replace && (
        <p className="text-sm text-muted-foreground">
          {t("backup.report.replaceSummary", {
            tables: report.replace.tablesImported,
            rows: report.replace.rowsImported,
            includeUsers: report.replace.includeUsers ? t("backup.report.yes") : t("backup.report.no"),
          })}
        </p>
      )}

      <PerTableReport tables={report.tables} />

      <NameList title={t("backup.report.skippedTables")} items={report.skippedTables} />
      <NameList title={t("backup.report.skippedModules")} items={report.skippedModules} />

      <CountList title={t("backup.report.blobs")} rows={blobRows} />

      {"reconcile" in report && (
        <CountList
          title={t("backup.report.reconcile")}
          rows={[
            { label: t("backup.report.reconcileChecked"), value: report.reconcile.checked },
            { label: t("backup.report.reconcileQuarantined"), value: report.reconcile.quarantined },
          ]}
        />
      )}

      <NameList title={t("backup.report.warnings")} items={report.warnings} />
    </div>
  );
}

export function BlobRestoreReportView({ report }: { readonly report: BlobRestoreReport }) {
  const { t } = useTranslation("settings");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t("backup.import.blobRestoreResultTitle")}</h3>
      <CountList
        title={t("backup.report.blobs")}
        rows={[
          { label: t("backup.report.blobsWritten"), value: report.written },
          { label: t("backup.report.blobsSkippedExisting"), value: report.skippedExisting },
          { label: t("backup.report.blobsFailed"), value: report.failed },
          { label: t("backup.report.unquarantined"), value: report.unquarantined },
        ]}
      />
      <CountList
        title={t("backup.report.reconcile")}
        rows={[
          { label: t("backup.report.reconcileChecked"), value: report.reconcile.checked },
          { label: t("backup.report.reconcileQuarantined"), value: report.reconcile.quarantined },
        ]}
      />
    </div>
  );
}
