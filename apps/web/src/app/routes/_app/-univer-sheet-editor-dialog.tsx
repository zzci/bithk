// State-driven Univer spreadsheet editor, rendered as a fullscreen-capable
// modal overlay that mirrors the markdown editor shell in
// `-file-preview-dialog.tsx` (fixed inset-0 overlay + fullscreen toggle +
// header Save / version-history / fullscreen / close). Closing clears the
// caller's state and stays in the current drive folder — there is no editor
// route to navigate back from.
//
// This is the ONLY module that imports `@univerjs/*`, so the spreadsheet
// engine ships in its own async chunk and never enters the main bundle. Every
// caller loads it via `React.lazy` so the chunk (and Univer) is fetched only
// when a sheet is actually opened. It loads the entry's snapshot (a Univer
// `IWorkbookData` JSON string) via the drive data layer, mounts Univer into a
// container, and saves edits back as a NEW drive file version.
import type { IWorkbookData } from "@univerjs/presets";
import type { DriveEntry } from "@/shared/lib/api/drive";
import { useQuery } from "@tanstack/react-query";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import sheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { History, Loader2, Maximize2, Minimize2, Save, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  fetchDriveEntryContent,
  UNIVER_SHEET_MIME,
  useUploadVersion,
} from "@/shared/lib/api/drive";
import { cn } from "@/shared/lib/utils";

import { DriveVersionHistoryDialog } from "./-drive-version-history-dialog";
import { ToolButton } from "./-file-preview-toolbar";

import "@univerjs/preset-sheets-core/lib/index.css";

interface UniverSheetEditorDialogProps {
  readonly entry: DriveEntry;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function localeBundle(locale: LocaleType) {
  return locale === LocaleType.ZH_CN ? sheetsCoreZhCN : sheetsCoreEnUS;
}

export function UniverSheetEditorDialog({ entry, open, onOpenChange }: UniverSheetEditorDialogProps) {
  const { t, i18n } = useTranslation("drive");
  const entryId = entry.id;

  // Keyed under `["drive", ...]` so the version dialog's switch invalidation
  // (which clears `driveKeys.all`) also refreshes this content.
  const contentQuery = useQuery({
    queryKey: ["drive", "entries", entryId, "content"],
    queryFn: () => fetchDriveEntryContent(entryId),
    enabled: open && !!entryId,
    staleTime: 0,
  });
  const uploadVersion = useUploadVersion();

  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<ReturnType<typeof createUniver> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

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

  // Esc closes the dialog; lock body scroll while open. Mirrors the markdown
  // overlay in `-file-preview-dialog.tsx`.
  useEffect(() => {
    if (!open)
      return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape")
        onOpenChange(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  async function handleSave() {
    const workbook = univerRef.current?.univerAPI.getActiveWorkbook();
    if (!workbook)
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

  if (!open)
    return null;

  const loading = contentQuery.isLoading;
  const loadError = contentQuery.isError || parsed.error;
  const ready = !loading && !loadError;
  const toolLabel = (key: string) => t(`preview.tools.${key}`);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/50 supports-backdrop-filter:backdrop-blur-xs",
        fullscreen ? "p-0" : "p-4",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget)
          onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry.name}
        className={fullscreen
          ? "flex h-full w-full flex-col overflow-hidden border bg-background shadow-xl"
          : "flex h-[86vh] max-h-[820px] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg border bg-background shadow-xl"}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
          <span className="min-w-0 max-w-[52vw] truncate text-sm font-medium">
            {entry.name || t("sheet.untitled")}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="default"
              disabled={!ready || uploadVersion.isPending}
              onClick={() => void handleSave()}
            >
              {uploadVersion.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {toolLabel("save")}
            </Button>
            <ToolButton label={t("versions.title")} onClick={() => setHistoryOpen(true)}>
              <History className="size-4" />
            </ToolButton>
            <ToolButton
              label={toolLabel(fullscreen ? "exitFullscreen" : "fullscreen")}
              pressed={fullscreen}
              onClick={() => setFullscreen(value => !value)}
            >
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </ToolButton>
            <ToolButton label={toolLabel("close")} onClick={() => onOpenChange(false)}>
              <X className="size-4" />
            </ToolButton>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              {t("sheet.loading")}
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 z-10 grid place-items-center text-sm text-destructive">
              {t("sheet.loadError")}
            </div>
          )}
          <div ref={containerRef} className="size-full" />
        </div>
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

export default UniverSheetEditorDialog;
