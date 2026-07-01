// State-driven Univer spreadsheet editor, rendered as a fullscreen-capable
// modal overlay that mirrors the markdown editor shell in
// `file/file-preview-dialog.tsx` (fixed inset-0 overlay + fullscreen toggle +
// header status / Save / version-history / fullscreen / close). Closing clears
// the caller's state and stays in the current drive folder — there is no editor
// route to navigate back from.
//
// Lock-free, version-only model (PLAN-099): there is no exclusive edit lock and
// no shared live-content draft. Editability is driven purely by the actor's
// capability (`canEdit`): editable when the caller can update the entry,
// read-only otherwise. Saving is split in two:
//   - Local draft: while editing, the workbook is persisted frequently to a
//     client-only localStorage draft (crash / refresh recovery, auto-restored
//     on reopen). This is the continuous save during a long editing session.
//   - Server version: written ONLY when the sheet has been idle for 2 minutes
//     after the last edit, or on a manual Save. During non-stop editing the
//     server is not touched — the local draft holds the work. A session
//     coalesces into a single version (first save creates it, later saves
//     overwrite it).
// The entry's display version (latest by default, or a pinned one) is what
// everyone else / preview / download / share sees.
//
// This is the ONLY module that imports `@univerjs/*`, so the spreadsheet
// engine ships in its own async chunk and never enters the main bundle. Every
// caller loads it via `React.lazy` so the chunk (and Univer) is fetched only
// when a sheet is actually opened. It loads the entry's display-version
// snapshot (a Univer `IWorkbookData` JSON string) via the drive data layer,
// mounts Univer into a container, and persists edits as new drive file
// versions.
import type { IWorkbookData } from "@univerjs/presets";
import type { DriveEntry } from "@/shared/lib/api/drive";
import { useQuery } from "@tanstack/react-query";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import sheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import sheetsCoreZhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import { CommandType, createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { Check, History, Lock, Maximize2, Minimize2, Pencil, Save, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ToolButton } from "@/shared/components/file/file-preview-toolbar";
import { DriveVersionHistoryDialog } from "@/shared/components/file/version-history-dialog";
import { Button } from "@/shared/components/ui/button";
import { FullscreenDialog } from "@/shared/components/ui/fullscreen-dialog";
import { Spinner } from "@/shared/components/ui/spinner";

import {
  fetchDriveEntryContent,
  UNIVER_SHEET_MIME,
  useOverwriteVersion,
  useUploadVersion,
} from "@/shared/lib/api/drive";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";

import "@univerjs/preset-sheets-core/lib/index.css";

// Server autosave: write a version 2 minutes after the last edit (the timer
// resets on every edit — so continuous editing never touches the server; only
// idling for 2 minutes, or a manual Save, does).
const AUTOSAVE_IDLE_MS = 120_000;
// Local draft: debounce the frequent client-only localStorage write while
// editing (crash / refresh recovery during a long continuous session).
const LOCAL_DRAFT_DEBOUNCE_MS = 3_000;
// Skip the localStorage draft for very large snapshots (~5MB per-origin cap).
const LOCAL_DRAFT_MAX_BYTES = 2_000_000;

interface SheetDraft {
  readonly content: string;
  readonly updatedAt: string;
}

function draftKey(userId: string, entryId: string): string {
  return `drive.sheet.draft.${userId}.${entryId}`;
}

/** Read a per-user local draft for an entry, or null when absent / unreadable. */
function readSheetDraft(userId: string, entryId: string): SheetDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(userId, entryId));
    if (!raw)
      return null;
    const parsed = JSON.parse(raw) as SheetDraft;
    return typeof parsed?.content === "string" ? parsed : null;
  }
  catch {
    return null;
  }
}

/** Best-effort local draft write (quota / private mode failures are ignored). */
function writeSheetDraft(userId: string, entryId: string, content: string): void {
  if (content.length > LOCAL_DRAFT_MAX_BYTES)
    return;
  try {
    window.localStorage.setItem(draftKey(userId, entryId), JSON.stringify({ content, updatedAt: new Date().toISOString() }));
  }
  catch {
    // Quota exceeded / storage unavailable — the draft is a best-effort net.
  }
}

function clearSheetDraft(userId: string, entryId: string): void {
  try {
    window.localStorage.removeItem(draftKey(userId, entryId));
  }
  catch {
    // ignore
  }
}

interface UniverSheetEditorDialogProps {
  readonly entry: DriveEntry;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Editable when the actor can update the entry; read-only otherwise. */
  readonly canEdit: boolean;
}

function localeBundle(locale: LocaleType) {
  return locale === LocaleType.ZH_CN ? sheetsCoreZhCN : sheetsCoreEnUS;
}

function formatNow(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function UniverSheetEditorDialog({ entry, open, onOpenChange, canEdit }: UniverSheetEditorDialogProps) {
  const { t, i18n } = useTranslation("drive");
  const entryId = entry.id;
  // Local drafts are keyed per user so a shared browser never leaks one
  // account's unsaved sheet into another's session.
  const userId = useAuthStore(s => s.user?.id) ?? null;

  // Keyed under `["drive", ...]` so the version dialog's set/clear invalidation
  // (which clears `driveKeys.all`) also refreshes this content.
  const contentQuery = useQuery({
    queryKey: ["drive", "entries", entryId, "content"],
    queryFn: () => fetchDriveEntryContent(entryId),
    enabled: open && !!entryId,
    staleTime: 0,
  });
  // Destructure the (stable) mutate fn so it can sit in effect/callback dep
  // arrays without dragging in the mutation object whose identity churns.
  const { mutateAsync: uploadVersionAsync, isPending: uploadingVersion } = useUploadVersion();
  const { mutateAsync: overwriteVersionAsync } = useOverwriteVersion();

  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<ReturnType<typeof createUniver> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Autosave UI state.
  const [univerReady, setUniverReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [savedTime, setSavedTime] = useState<string | null>(null);

  // Mirrors of mutable state read inside timers / engine callbacks, kept in
  // refs to dodge stale closures.
  const dirtyRef = useRef(false);
  const canEditRef = useRef(canEdit);
  // Guards a flush after unmount: once the dialog is gone we must not fire a
  // save (the mutation + toast would run against a torn-down tree).
  const unmountedRef = useRef(false);
  const saveVersionRef = useRef<() => Promise<void>>(async () => {});
  // Session-coalesced autosave: the version this editing session owns. The first
  // save of a session creates it; every later save overwrites it — so one open
  // session yields a single version. Reset per open (null → next save creates).
  const sessionVersionIdRef = useRef<string | null>(null);
  // Timers: `idleTimerRef` fires the SERVER save 2 minutes after the last edit
  // (reset on every edit); `localTimerRef` fires the frequent local draft write.
  // `savingRef` guards a create from racing into a duplicate version.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const userIdRef = useRef(userId);
  // Fires the restored-draft toast at most once per open.
  const restoredToastedRef = useRef(false);

  const clearAutosaveTimers = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (localTimerRef.current) {
      clearTimeout(localTimerRef.current);
      localTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const snapshot = contentQuery.data;
  const locale = i18n.language.toLowerCase().startsWith("zh") ? LocaleType.ZH_CN : LocaleType.EN_US;

  // A local draft (from a prior crashed / closed session) takes precedence over
  // the server snapshot on open; its presence marks the sheet dirty so the
  // recovered edits are written back as a version on the next idle / manual save.
  const draft = useMemo(() => (open && userId ? readSheetDraft(userId, entryId) : null), [open, userId, entryId]);

  // Parse the effective snapshot (local draft over server) in render so a
  // malformed file surfaces as a load error without an effect-driven re-render.
  const parsed = useMemo<{ data: IWorkbookData | null; error: boolean }>(() => {
    const source = draft?.content ?? snapshot;
    if (source === undefined)
      return { data: null, error: false };
    try {
      return { data: JSON.parse(source) as IWorkbookData, error: false };
    }
    catch {
      return { data: null, error: true };
    }
  }, [draft, snapshot]);
  const workbookData = parsed.data;

  // ── Save the current workbook into this session's version ──
  // Stored behind a ref so timers always call the latest closure. The first
  // save creates the session's version (capturing its id from the returned
  // newest-first list); every later save overwrites that same version so a
  // session coalesces into one version. Cancels any pending idle timer, and the
  // in-flight guard blocks a concurrent create from duplicating the version.
  const saveVersion = useCallback(async () => {
    if (!canEditRef.current || savingRef.current)
      return;
    const workbook = univerRef.current?.univerAPI.getActiveWorkbook();
    if (!workbook)
      return;
    // A save now satisfies both the idle debounce and the max-wait net.
    clearAutosaveTimers();
    const content = JSON.stringify(workbook.save());
    savingRef.current = true;
    setSaving(true);
    try {
      const file = new File([content], entry.name, { type: UNIVER_SHEET_MIME });
      if (sessionVersionIdRef.current) {
        await overwriteVersionAsync({ entryId, versionId: sessionVersionIdRef.current, file });
      }
      else {
        const versions = await uploadVersionAsync({ entryId, file });
        // Newest first (ULID id desc) → [0] is the just-created session version.
        sessionVersionIdRef.current = versions[0]?.id ?? null;
      }
      // Content is now a server version — drop the local recovery draft (later
      // edits recreate it on the next local tick). Done before the unmount guard
      // so a close mid-save still clears the now-persisted draft.
      if (userIdRef.current)
        clearSheetDraft(userIdRef.current, entryId);
      if (unmountedRef.current)
        return;
      setDirty(false);
      setSaveFailed(false);
      setSavedTime(formatNow());
    }
    catch {
      if (!unmountedRef.current)
        setSaveFailed(true);
    }
    finally {
      savingRef.current = false;
      if (!unmountedRef.current)
        setSaving(false);
    }
  }, [entryId, entry.name, uploadVersionAsync, overwriteVersionAsync, clearAutosaveTimers]);

  useEffect(() => {
    saveVersionRef.current = saveVersion;
  }, [saveVersion]);

  // ── Reset per-open session state ──
  useEffect(() => {
    if (!open)
      return undefined;
    unmountedRef.current = false;
    sessionVersionIdRef.current = null;
    restoredToastedRef.current = false;
    setDirty(false);
    setSaveFailed(false);
    setSavedTime(null);
    return undefined;
  }, [open, entryId]);

  // ── Persist the local draft on close / unmount ──
  // Closing does NOT create a server version (versions come only from idle /
  // manual saves). Instead flush the latest workbook to the local draft so a
  // close between debounce ticks stays recoverable, then restored on reopen.
  useEffect(() => {
    if (!open)
      return undefined;
    return () => {
      unmountedRef.current = true;
      if (canEditRef.current && dirtyRef.current && userIdRef.current) {
        const workbook = univerRef.current?.univerAPI.getActiveWorkbook();
        if (workbook)
          writeSheetDraft(userIdRef.current, entryId, JSON.stringify(workbook.save()));
      }
    };
  }, [open, entryId]);

  // ── Cancel any pending autosave timers when the dialog closes ──
  // The timers are (re)armed from the edit (MUTATION) handler below.
  useEffect(() => {
    if (open)
      return undefined;
    clearAutosaveTimers();
    return undefined;
  }, [open, clearAutosaveTimers]);

  // Mount Univer once the container is in the DOM and the snapshot has parsed.
  // Re-runs when the data changes (e.g. after setting the display version) or
  // the UI locale changes, tearing down the previous instance first. The
  // command subscription marks the workbook dirty — gated to `canEdit` via the
  // ref so read-only sessions never dirty/autosave.
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
      if (!canEditRef.current)
        return;
      // MUTATIONs are the snapshot-changing edits; ignore selection/operations.
      if (command.type !== CommandType.MUTATION)
        return;
      setDirty(true);
      // Server save: (re)arm the idle timer so a version is written 2 minutes
      // after the LAST edit — continuous editing keeps pushing it back, so the
      // server is only touched once the user pauses (or saves manually).
      if (idleTimerRef.current)
        clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        void saveVersionRef.current();
      }, AUTOSAVE_IDLE_MS);
      // Local draft: a short debounce writes the workbook to localStorage so a
      // long continuous session stays recoverable without touching the server.
      if (localTimerRef.current)
        clearTimeout(localTimerRef.current);
      localTimerRef.current = setTimeout(() => {
        localTimerRef.current = null;
        const workbook = univerRef.current?.univerAPI.getActiveWorkbook();
        if (workbook && userIdRef.current)
          writeSheetDraft(userIdRef.current, entryId, JSON.stringify(workbook.save()));
      }, LOCAL_DRAFT_DEBOUNCE_MS);
    });
    setUniverReady(true);

    return () => {
      subscription.dispose();
      clearAutosaveTimers();
      setUniverReady(false);
      instance.univer.dispose();
      univerRef.current = null;
    };
  }, [workbookData, locale, clearAutosaveTimers]);

  // Apply engine-level editability whenever `canEdit` or the instance changes.
  useEffect(() => {
    if (!univerReady)
      return;
    univerRef.current?.univerAPI.getActiveWorkbook()?.setEditable(canEdit);
  }, [canEdit, univerReady]);

  // A recovered local draft: mark the sheet dirty (so it is written back on the
  // next idle / manual save) and announce the recovery once per open.
  useEffect(() => {
    if (!open || !draft || !univerReady)
      return;
    setDirty(true);
    if (!restoredToastedRef.current) {
      restoredToastedRef.current = true;
      toast.info(t("sheet.restoredDraft"));
    }
  }, [open, draft, univerReady, t]);

  const handleSave = useCallback(() => {
    void saveVersion().then(() => {
      if (!unmountedRef.current && !saveFailed)
        toast.success(t("sheet.saved"));
    });
  }, [saveVersion, saveFailed, t]);

  // Always-visible status indicator. Precedence:
  // read-only > saving > save-failed > unsaved > saved.
  const status = useMemo(() => {
    if (!canEdit)
      return { icon: <Lock className="size-3.5" />, text: t("sheet.readOnly"), tone: "text-muted-foreground" };
    if (saving)
      return { icon: <Spinner className="size-3.5" />, text: t("sheet.saving"), tone: "text-muted-foreground" };
    if (saveFailed)
      return { icon: <TriangleAlert className="size-3.5" />, text: t("sheet.saveFailed"), tone: "text-destructive" };
    if (dirty)
      return { icon: <Pencil className="size-3.5" />, text: t("sheet.unsaved"), tone: "text-muted-foreground" };
    if (savedTime)
      return { icon: <Check className="size-3.5" />, text: t("sheet.savedAt", { time: savedTime }), tone: "text-muted-foreground" };
    return null;
  }, [canEdit, saving, saveFailed, dirty, savedTime, t]);

  if (!open)
    return null;

  const loading = contentQuery.isLoading;
  const loadError = contentQuery.isError || parsed.error;
  const ready = !loading && !loadError;
  const toolLabel = (key: string) => t(`preview.tools.${key}`);

  return (
    <>
      <FullscreenDialog open={open} onOpenChange={onOpenChange} fullscreen={fullscreen} ariaLabel={entry.name}>
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
            {canEdit && (
              <Button
                type="button"
                variant="default"
                disabled={!ready || uploadingVersion}
                onClick={handleSave}
              >
                {uploadingVersion ? <Spinner /> : <Save className="size-4" />}
                {t("sheet.save")}
              </Button>
            )}
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
      </FullscreenDialog>

      <DriveVersionHistoryDialog
        entry={entry}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        readOnly={!canEdit}
        onSwitched={() => {
          setHistoryOpen(false);
          setDirty(false);
          void contentQuery.refetch();
        }}
      />
    </>
  );
}

export default UniverSheetEditorDialog;
