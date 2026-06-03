/* eslint-disable react-refresh/only-export-components */
// Route-level lazy chunk for the Univer spreadsheet editor. This is the ONLY
// module that imports `@univerjs/*`, so the spreadsheet engine ships in its own
// async chunk and never enters the main bundle. It loads the entry's snapshot
// (a Univer `IWorkbookData` JSON string) via the drive data layer, mounts Univer
// into a container, and saves edits back as a NEW drive file version.
import type { IWorkbookData } from "@univerjs/presets";
import { useQuery } from "@tanstack/react-query";
import { createLazyFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import sheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { ArrowLeft, History, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import {
  fetchDriveEntryContent,
  UNIVER_SHEET_MIME,
  useDriveEntry,
  useUploadVersion,
} from "@/shared/lib/api/drive";
import { DriveVersionHistoryDialog } from "./-drive-version-history-dialog";
import "@univerjs/preset-sheets-core/lib/index.css";

export const Route = createLazyFileRoute("/_app/drive_/sheet/$entryId")({
  component: DriveSheetEditorPage,
});

function localeBundle(locale: LocaleType) {
  return locale === LocaleType.ZH_CN ? sheetsCoreZhCN : sheetsCoreEnUS;
}

function DriveSheetEditorPage() {
  const { entryId } = useParams({ from: "/_app/drive_/sheet/$entryId" });
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("drive");

  const entryQuery = useDriveEntry(entryId);
  // Keyed under `["drive", ...]` so the version dialog's switch invalidation
  // (which clears `driveKeys.all`) also refreshes this content.
  const contentQuery = useQuery({
    queryKey: ["drive", "entries", entryId, "content"],
    queryFn: () => fetchDriveEntryContent(entryId),
    enabled: !!entryId,
    staleTime: 0,
  });
  const uploadVersion = useUploadVersion();

  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<ReturnType<typeof createUniver> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const entry = entryQuery.data ?? null;
  const snapshot = contentQuery.data;
  const locale = i18n.language.toLowerCase().startsWith("zh") ? LocaleType.ZH_CN : LocaleType.EN_US;

  // Parse the snapshot string in render so a malformed file surfaces as a load
  // error without an effect-driven extra render.
  const parsed = useMemo<{ data: IWorkbookData | null; error: boolean }>(() => {
    if (snapshot === undefined)
      return { data: null, error: false };
    try {
      return { data: JSON.parse(snapshot) as IWorkbookData, error: false };
    }
    catch {
      return { data: null, error: true };
    }
  }, [snapshot]);
  const workbookData = parsed.data;

  // Mount Univer once the container is in the DOM and the snapshot has parsed.
  // Re-runs when the data changes (e.g. after a version switch) or the UI
  // locale changes, tearing down the previous instance first.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !workbookData)
      return undefined;

    const instance = createUniver({
      locale,
      locales: { [locale]: mergeLocales(localeBundle(locale)) },
      presets: [UniverSheetsCorePreset({ container })],
    });
    univerRef.current = instance;
    instance.univerAPI.createWorkbook(workbookData);

    return () => {
      instance.univer.dispose();
      univerRef.current = null;
    };
  }, [workbookData, locale]);

  async function handleSave() {
    const workbook = univerRef.current?.univerAPI.getActiveWorkbook();
    if (!workbook || !entry)
      return;
    const file = new File([JSON.stringify(workbook.save())], entry.name, { type: UNIVER_SHEET_MIME });
    try {
      await uploadVersion.mutateAsync({ entryId, file });
      toast.success(t("sheet.saved"));
    }
    catch {
      toast.error(t("sheet.saveError"));
    }
  }

  const loading = entryQuery.isLoading || contentQuery.isLoading;
  const loadError = entryQuery.isError || contentQuery.isError || parsed.error;
  const ready = !loading && !loadError;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b pb-2">
        <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/drive" })}>
          <ArrowLeft className="size-4" />
          {t("sheet.back")}
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {entry?.name ?? t("sheet.untitled")}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!entry}
          onClick={() => setHistoryOpen(true)}
        >
          <History className="size-4" />
          {t("sheet.versions")}
        </Button>
        <Button
          size="sm"
          disabled={!ready || uploadVersion.isPending}
          onClick={() => void handleSave()}
        >
          {uploadVersion.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {uploadVersion.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            {t("sheet.loading")}
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 grid place-items-center text-sm text-destructive">
            {t("sheet.loadError")}
          </div>
        )}
        <div ref={containerRef} className="size-full" />
      </div>

      <DriveVersionHistoryDialog
        entry={entry}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onSwitched={() => {
          setHistoryOpen(false);
          void contentQuery.refetch();
        }}
      />
    </div>
  );
}
