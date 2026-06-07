// State-driven Univer spreadsheet editor, rendered as a fullscreen-capable
// modal overlay that mirrors the markdown editor shell in
// `-file-preview-dialog.tsx` (fixed inset-0 overlay + fullscreen toggle +
// header status / Save-as-version / version-history / fullscreen / close).
// Closing clears the caller's state and stays in the current drive folder —
// there is no editor route to navigate back from.
//
// Editing is Google-Sheets-style: a single writer at a time. On open the
// dialog acquires a pessimistic exclusive edit lock; a second opener becomes
// read-only with a banner + "Retry editing". While editing it heartbeats the
// lock every 30s and autosaves the live (mutable) content after 30s of idle,
// surfacing an always-visible status indicator. "Save as version" still
// snapshots an immutable version. There is NO realtime collaboration.
//
// This is the ONLY module that imports `@univerjs/*`, so the spreadsheet
// engine ships in its own async chunk and never enters the main bundle. Every
// caller loads it via `React.lazy` so the chunk (and Univer) is fetched only
// when a sheet is actually opened. It loads the entry's snapshot (a Univer
// `IWorkbookData` JSON string) via the drive data layer, mounts Univer into a
// container, and persists edits to the live-content slot (autosave) or as a
// NEW drive file version (manual save).
import type { IWorkbookData } from "@univerjs/presets";
import type { DriveEntry, EditLockError } from "@/shared/lib/api/drive";
import { useQuery } from "@tanstack/react-query";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import sheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import { CommandType, createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { Check, History, Lock, Maximize2, Minimize2, Pencil, Save, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  fetchDriveEntryContent,
  releaseEditLockBeacon,
  UNIVER_SHEET_MIME,
  useAcquireEditLock,
  useHeartbeatEditLock,
  useReleaseEditLock,
  useUpdateEntryLiveContent,
  useUploadVersion,
} from "@/shared/lib/api/drive";
import { cn } from "@/shared/lib/utils";

import { DriveVersionHistoryDialog } from "./-drive-version-history-dialog";
import { ToolButton } from "./-file-preview-toolbar";

import "@univerjs/preset-sheets-core/lib/index.css";

// Lock-lifecycle constants. Heartbeat / autosave-idle are both 30s; the
// server-side lock TTL (90s) is the backstop and is NOT hardcoded here beyond
// the heartbeat cadence that keeps the lock alive.
const HEARTBEAT_MS = 30_000;
const AUTOSAVE_IDLE_MS = 30_000;
const SAVE_RETRY_MS = 5_000;

type EditMode = "loading" | "editable" | "readonly";

interface UniverSheetEditorDialogProps {
  readonly entry: DriveEntry;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function localeBundle(locale: LocaleType) {
  return locale === LocaleType.ZH_CN ? sheetsCoreZhCN : sheetsCoreEnUS;
}

function formatNow(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  // Destructure the (stable) mutate fns so they can sit in effect/callback
  // dep arrays without dragging in the mutation object whose identity churns
  // every render (which would re-run the acquire effect on a loop).
  const { mutateAsync: uploadVersionAsync, isPending: uploadingVersion } = useUploadVersion();
  const { mutateAsync: acquireEditLock, isPending: acquiring } = useAcquireEditLock();
  const { mutateAsync: heartbeatEditLock } = useHeartbeatEditLock();
  const { mutate: releaseEditLockMutate } = useReleaseEditLock();
  const { mutateAsync: updateLiveContentAsync } = useUpdateEntryLiveContent();

  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<ReturnType<typeof createUniver> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Lock + autosave UI state.
  const [mode, setMode] = useState<EditMode>("loading");
  const [lockBy, setLockBy] = useState<string | null>(null);
  const [univerReady, setUniverReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [savedTime, setSavedTime] = useState<string | null>(null);

  // Mirrors of mutable state read inside timers / engine callbacks, kept in
  // refs to dodge stale closures.
  const editIdRef = useRef("");
  const modeRef = useRef<EditMode>("loading");
  const dirtyRef = useRef(false);
  const releasedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveRef = useRef<() => void>(() => {});

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

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

  // ── Take over (lost lock) → read-only + probe the new holder ──
  // A heartbeat / autosave 409 (DRIVE_EDIT_LOCK_STALE) carries no holder, so
  // probe once via acquire: if it 409s with `lockBy` we name the holder; if it
  // succeeds the lock was actually free → resume editing.
  const handleTakenOver = useCallback(() => {
    if (modeRef.current !== "editable")
      return;
    setMode("readonly");
    setSaveFailed(false);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    toast.error(t("sheet.takenOver"));
    acquireEditLock({ entryId, editId: editIdRef.current })
      .then(() => {
        setMode("editable");
        setLockBy(null);
      })
      .catch((err: EditLockError) => {
        setLockBy(err.code === "DRIVE_EDIT_LOCKED" ? (err.lockBy ?? null) : null);
      });
  }, [entryId, acquireEditLock, t]);

  // ── Autosave the live (mutable) content ──
  // Stored behind a ref so timers always call the latest closure. On a 409
  // (lock lost) go read-only; on any other failure keep the changes dirty,
  // surface "Save failed", and retry until it lands or the lock is lost.
  const autosave = useCallback(async () => {
    if (modeRef.current !== "editable")
      return;
    const workbook = univerRef.current?.univerAPI.getActiveWorkbook();
    if (!workbook)
      return;
    const content = JSON.stringify(workbook.save());
    setSaving(true);
    try {
      await updateLiveContentAsync({ entryId, editId: editIdRef.current, content });
      setDirty(false);
      setSaveFailed(false);
      setSavedTime(formatNow());
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    }
    catch (err) {
      if ((err as EditLockError).code === "DRIVE_EDIT_LOCK_STALE") {
        handleTakenOver();
      }
      else {
        setSaveFailed(true);
        if (retryRef.current)
          clearTimeout(retryRef.current);
        retryRef.current = setTimeout(() => autosaveRef.current(), SAVE_RETRY_MS);
      }
    }
    finally {
      setSaving(false);
    }
  }, [entryId, updateLiveContentAsync, handleTakenOver]);

  useEffect(() => {
    autosaveRef.current = () => {
      void autosave();
    };
  }, [autosave]);

  // ── Flush + release the lock exactly once per session ──
  const flushAndRelease = useCallback(() => {
    if (releasedRef.current)
      return;
    const editId = editIdRef.current;
    if (!editId)
      return;
    releasedRef.current = true;
    if (modeRef.current === "editable" && dirtyRef.current) {
      const workbook = univerRef.current?.univerAPI.getActiveWorkbook();
      if (workbook) {
        const content = JSON.stringify(workbook.save());
        void updateLiveContentAsync({ entryId, editId, content }).catch(() => {});
      }
    }
    releaseEditLockMutate({ entryId, editId });
  }, [entryId, updateLiveContentAsync, releaseEditLockMutate]);

  // ── Acquire the lock when the dialog opens (regenerate the session id) ──
  useEffect(() => {
    if (!open)
      return undefined;
    const editId = crypto.randomUUID();
    editIdRef.current = editId;
    releasedRef.current = false;
    setDirty(false);
    setSaveFailed(false);
    setSavedTime(null);
    setLockBy(null);
    setMode("loading");
    let cancelled = false;
    acquireEditLock({ entryId, editId })
      .then(() => {
        if (!cancelled)
          setMode("editable");
      })
      .catch((err: EditLockError) => {
        if (cancelled)
          return;
        if (err.code === "DRIVE_EDIT_LOCKED") {
          setLockBy(err.lockBy ?? null);
        }
        else {
          toast.error(t("sheet.lockError"));
        }
        setMode("readonly");
      });
    return () => {
      cancelled = true;
    };
    // Intentionally acquire only on open/entry change; `t` would re-acquire
    // (and regenerate the editId) on a language switch mid-edit.
    // eslint-disable-next-line react/exhaustive-deps
  }, [open, entryId, acquireEditLock]);

  // ── Flush + release on close (open true→false) / unmount ──
  useEffect(() => {
    if (!open)
      return undefined;
    return () => flushAndRelease();
  }, [open, flushAndRelease]);

  // ── Heartbeat keeps the lock alive while editing ──
  useEffect(() => {
    if (!open || mode !== "editable")
      return undefined;
    const interval = setInterval(() => {
      heartbeatEditLock({ entryId, editId: editIdRef.current })
        .catch((err: EditLockError) => {
          if (err.code === "DRIVE_EDIT_LOCK_STALE")
            handleTakenOver();
        });
    }, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [open, mode, entryId, heartbeatEditLock, handleTakenOver]);

  // ── Free the lock promptly on tab close / crash (TTL is the backstop) ──
  useEffect(() => {
    if (!open || mode !== "editable")
      return undefined;
    const handler = () => {
      if (releasedRef.current)
        return;
      releasedRef.current = true;
      void releaseEditLockBeacon(entryId, editIdRef.current);
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open, mode, entryId]);

  // Mount Univer once the container is in the DOM and the snapshot has parsed.
  // Re-runs when the data changes (e.g. after a version switch) or the UI
  // locale changes, tearing down the previous instance first. The command
  // subscription marks the workbook dirty and (re)starts the idle-autosave
  // debounce — gated to `editable` via the mode ref so read-only sessions
  // never autosave.
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

    const subscription = instance.univerAPI.onCommandExecuted((command) => {
      if (modeRef.current !== "editable")
        return;
      // MUTATIONs are the snapshot-changing edits; ignore selection/operations.
      if (command.type !== CommandType.MUTATION)
        return;
      setDirty(true);
      if (debounceRef.current)
        clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => autosaveRef.current(), AUTOSAVE_IDLE_MS);
    });
    setUniverReady(true);

    return () => {
      subscription.dispose();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setUniverReady(false);
      instance.univer.dispose();
      univerRef.current = null;
    };
  }, [workbookData, locale]);

  // Apply engine-level read-only whenever the mode or instance changes.
  useEffect(() => {
    if (!univerReady)
      return;
    univerRef.current?.univerAPI.getActiveWorkbook()?.setEditable(mode === "editable");
  }, [mode, univerReady]);

  // Clear any pending timers on unmount (debounce is also cleared on remount).
  useEffect(() => {
    return () => {
      if (debounceRef.current)
        clearTimeout(debounceRef.current);
      if (retryRef.current)
        clearTimeout(retryRef.current);
    };
  }, []);

  // Esc closes the dialog; lock body scroll while open. Mirrors the markdown
  // overlay in `-file-preview-dialog.tsx`.
  useEffect(() => {
    if (!open)
      return undefined;
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

  // Re-attempt acquiring the lock (the holder may have released or the TTL
  // expired) from the read-only banner.
  const retryEditing = useCallback(async () => {
    try {
      await acquireEditLock({ entryId, editId: editIdRef.current });
      setMode("editable");
      setLockBy(null);
    }
    catch (err) {
      const e = err as EditLockError;
      if (e.code === "DRIVE_EDIT_LOCKED")
        setLockBy(e.lockBy ?? null);
      else
        toast.error(t("sheet.lockError"));
    }
  }, [entryId, acquireEditLock, t]);

  async function handleSave() {
    const workbook = univerRef.current?.univerAPI.getActiveWorkbook();
    if (!workbook)
      return;
    const file = new File([JSON.stringify(workbook.save())], entry.name, { type: UNIVER_SHEET_MIME });
    try {
      await uploadVersionAsync({ entryId, file });
      toast.success(t("sheet.saved"));
    }
    catch {
      toast.error(t("sheet.saveError"));
    }
  }

  // Always-visible autosave status indicator. Precedence:
  // read-only > saving > save-failed > unsaved > saved.
  const status = useMemo(() => {
    if (mode === "readonly") {
      return {
        icon: <Lock className="size-3.5" />,
        text: lockBy ? t("sheet.readonlyEditing", { user: lockBy }) : t("sheet.readOnly"),
        tone: "text-muted-foreground",
      };
    }
    if (saving)
      return { icon: <Spinner className="size-3.5" />, text: t("sheet.saving"), tone: "text-muted-foreground" };
    if (saveFailed)
      return { icon: <TriangleAlert className="size-3.5" />, text: t("sheet.saveFailed"), tone: "text-destructive" };
    if (dirty)
      return { icon: <Pencil className="size-3.5" />, text: t("sheet.unsaved"), tone: "text-muted-foreground" };
    if (savedTime)
      return { icon: <Check className="size-3.5" />, text: t("sheet.savedAt", { time: savedTime }), tone: "text-muted-foreground" };
    return null;
  }, [mode, lockBy, saving, saveFailed, dirty, savedTime, t]);

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
          <div className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 max-w-[40vw] truncate text-sm font-medium">
              {entry.name || t("sheet.untitled")}
            </span>
            {status && (
              <span
                role="status"
                aria-live="polite"
                className={cn("flex shrink-0 items-center gap-1.5 text-xs", status.tone)}
              >
                {status.icon}
                {status.text}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="default"
              disabled={!ready || uploadingVersion || mode !== "editable"}
              onClick={() => void handleSave()}
            >
              {uploadingVersion ? <Spinner /> : <Save className="size-4" />}
              {t("sheet.saveAsVersion")}
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

        {mode === "readonly" && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <Lock className="size-4 shrink-0" />
              <span className="truncate">{lockBy ? t("sheet.editingBy", { user: lockBy }) : t("sheet.readOnly")}</span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={acquiring}
              onClick={() => void retryEditing()}
            >
              {acquiring && <Spinner />}
              {t("sheet.retryEditing")}
            </Button>
          </div>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground">
              <Spinner size="lg" />
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
          setDirty(false);
          void contentQuery.refetch();
        }}
      />
    </div>
  );
}

export default UniverSheetEditorDialog;
