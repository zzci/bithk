// Create-issue composer dialog for the issues (work orders) tab. Extracted
// from -project-issues-tab.tsx so the list and the composer each stay under the
// file-size cap. Borderless title/description, inline metadata pills (status,
// priority, assignee, due date, attachments, worklist reference), staged
// attachments uploaded after the create resolves, and a keep-open switch for
// filing several issues in a row.

import type {
  CreateProjectIssueInput,
  IssuePriority,
  IssueStatus,
  ProjectMemberView,
  ReferenceableWorklist,
} from "@/shared/lib/api/projects";
import { ClipboardList, Maximize2, Minimize2, Paperclip, User, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileUploadButton } from "@/shared/components/file";
import { PriorityGlyph } from "@/shared/components/priority-signal";
import { validateAttachmentSelection } from "@/shared/components/resource";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import { useUploadLimits } from "@/shared/hooks/use-upload-limits";
import { uploadIssueAttachment, useCreateProjectIssue } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { formatBytes } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { ISSUE_PRIORITIES, ISSUE_PRIORITY_LABEL_KEY, ISSUE_STATUS_LABEL_KEY, ISSUE_STATUSES } from "./-issue-labels";
import { StatusIcon } from "./-issue-row";
import { WorklistPicker } from "./-worklist-picker";

interface CreateIssueDialogProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly memberLabels: ReadonlyMap<string, string>;
  readonly initialStatus: IssueStatus;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** When true, a worklist pill lets the work order reference one of the project's worklists. */
  readonly canReferenceWorklists?: boolean;
}

// Render a worklist's free-form `checklist` defensively: a JSON array of strings
// becomes a markdown bullet list; anything else is used verbatim.
function renderChecklist(checklist: string | null): string {
  if (!checklist)
    return "";
  try {
    const parsed = JSON.parse(checklist) as unknown;
    if (Array.isArray(parsed) && parsed.every(item => typeof item === "string"))
      return parsed.map(item => `- ${item}`).join("\n");
  }
  catch {
    // Not JSON — fall through to the raw text.
  }
  return checklist;
}

export function CreateIssueDialog({ projectId, members, memberLabels, initialStatus, open, onOpenChange, canReferenceWorklists = false }: CreateIssueDialogProps) {
  const { t } = useTranslation(["projects", "common", "issues"]);
  const createIssue = useCreateProjectIssue();
  const limits = useUploadLimits();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IssueStatus>(initialStatus);
  const [priority, setPriority] = useState<IssuePriority>("low");
  const [assigneeMemberId, setAssigneeMemberId] = useState("__none__");
  const [dueDate, setDueDate] = useState("");
  // The issue does not exist until creation, so selected attachments are staged
  // here and uploaded to the new issue once the create resolves.
  const [files, setFiles] = useState<File[]>([]);
  // When on, a successful create resets the form and keeps the dialog open so
  // the user can file several issues in a row.
  const [keepOpen, setKeepOpen] = useState(false);
  // Toggles the dialog between its default width and a roomy maximized size.
  const [maximized, setMaximized] = useState(false);
  // The referenced worklist (id + name), set when one is picked. Recorded as a
  // reference on submit; clearing the chip drops the reference but keeps the
  // already-filled title/description.
  const [selectedWorklist, setSelectedWorklist] = useState<{ id: string; name: string } | null>(null);
  const [worklistPickerOpen, setWorklistPickerOpen] = useState(false);
  const dueDateInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  // Picking a worklist pre-fills the title (its name) and the description
  // (rendered checklist + precautions), and records the reference.
  const onSelectWorklist = (worklist: ReferenceableWorklist) => {
    setTitle(worklist.name);
    const checklistRendered = renderChecklist(worklist.checklist);
    const precautions = worklist.precautions?.trim() ?? "";
    const blocks = [checklistRendered];
    if (precautions)
      blocks.push(`${t("issues.worklist.precautionsLabel")}:\n${precautions}`);
    setDescription(blocks.filter(Boolean).join("\n\n"));
    setSelectedWorklist({ id: worklist.id, name: worklist.name });
    setWorklistPickerOpen(false);
  };

  // Stage a file selection: validate against the same limits the issue panel
  // enforces (count + per-file size), then keep accepted files in state.
  const onPickFiles = (picked: File[]) => {
    if (picked.length === 0)
      return;
    const validation = validateAttachmentSelection(picked, files.length, limits.maxFileSize, limits.maxAttachmentsPerResource);
    if (validation === "limit") {
      toast.error(t("issues:attachments.limitReached"));
      return;
    }
    if (validation === "size") {
      toast.error(t("issues:attachments.fileTooLarge"));
      return;
    }
    setFiles(prev => [...prev, ...picked]);
  };

  // Drop a single staged file before submit; in-memory only (the issue does
  // not exist yet, so there is nothing to delete server-side).
  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index));

  // Open the native calendar on click; fall back to focus when showPicker is
  // unavailable (older browsers / programmatic-open restrictions).
  const openDuePicker = () => {
    const input = dueDateInputRef.current;
    if (!input)
      return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      }
      catch {
        // showPicker can throw if not allowed; fall through to focus.
      }
    }
    input.focus();
  };

  const reset = () => {
    setTitle("");
    setDescription("");
    setStatus(initialStatus);
    setPriority("low");
    setAssigneeMemberId("__none__");
    setDueDate("");
    setFiles([]);
    setSelectedWorklist(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || createIssue.isPending)
      return;
    const body: CreateProjectIssueInput = {
      title: title.trim(),
      status,
      priority,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(assigneeMemberId !== "__none__" ? { assigneeMemberId } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(selectedWorklist
        ? { references: [{ refType: "worklist", refId: selectedWorklist.id, label: selectedWorklist.name }] as const }
        : {}),
    };
    const staged = files;
    createIssue.mutate({ projectId, ...body }, {
      onSuccess: async (created) => {
        // The issue exists now, so upload any staged attachments to it. An
        // upload failure is surfaced but does not undo the created issue.
        if (staged.length > 0) {
          try {
            for (const file of staged) {
              await uploadIssueAttachment(projectId, created.id, file);
            }
          }
          catch (err) {
            toast.error(errorMessage(err, t("common:common.error.operationFailed")));
          }
        }
        toast.success(t("toast.issueCreated"));
        reset();
        if (!keepOpen)
          onOpenChange(false);
      },
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  // Inline metadata controls use the Button `pill` size; each adds its own
  // border style to reflect a set (solid) vs empty (dashed) state.
  const assigned = assigneeMemberId !== "__none__";
  const assigneeLabel = assigned
    ? memberLabels.get(assigneeMemberId) ?? assigneeMemberId
    : t("issues.field.assignee");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto pb-0",
          maximized ? "min-h-[80svh] sm:max-w-3xl" : "sm:max-w-xl",
        )}
      >
        {/* Window controls float at the top-right corner; the breadcrumb header
            is gone, so the body starts straight at the title. The primitive's
            own close is disabled in favor of this DialogClose. */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t(maximized ? "issues.composer.minimize" : "issues.composer.maximize")}
            onClick={() => setMaximized(m => !m)}
          >
            {maximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </Button>
          <DialogClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("common:common.close")} />}>
            <X aria-hidden="true" />
          </DialogClose>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {/* The borderless title replaces the visible header; keep a
              visually-hidden DialogTitle so the dialog primitive and screen
              readers still announce a name. */}
          <DialogTitle className="sr-only">{t("issues.createTitle")}</DialogTitle>

          {createIssue.error && <ErrorBanner message={errorMessage(createIssue.error, t("common:common.error.operationFailed"))} />}

          <Input
            autoFocus
            required
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t("issues.composer.titlePlaceholder")}
            aria-label={t("issues.field.title")}
            className="h-auto border-0 bg-transparent px-0 py-0 pr-16 text-lg font-medium shadow-none focus-visible:border-0 focus-visible:ring-0"
          />

          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t("issues.field.descriptionPlaceholder")}
            aria-label={t("issues.field.description")}
            rows={6}
            className={cn(
              "resize-y border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-0 focus-visible:ring-0",
              maximized ? "min-h-[60svh]" : "min-h-40",
            )}
          />

          <div className="flex flex-wrap items-center gap-2 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" size="pill" className="border-solid" />}>
                <StatusIcon status={status} label={t(ISSUE_STATUS_LABEL_KEY[status])} />
                {t(ISSUE_STATUS_LABEL_KEY[status])}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={status} onValueChange={v => setStatus(v as IssueStatus)}>
                  {ISSUE_STATUSES.map(s => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      <StatusIcon status={s} label={t(ISSUE_STATUS_LABEL_KEY[s])} />
                      {t(ISSUE_STATUS_LABEL_KEY[s])}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" size="pill" className="border-solid" />}>
                <PriorityGlyph priority={priority} />
                {t(ISSUE_PRIORITY_LABEL_KEY[priority])}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={priority} onValueChange={v => setPriority(v as IssuePriority)}>
                  {ISSUE_PRIORITIES.map(p => (
                    <DropdownMenuRadioItem key={p} value={p}>
                      <PriorityGlyph priority={p} />
                      {t(ISSUE_PRIORITY_LABEL_KEY[p])}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger render={(
                <Button
                  type="button"
                  variant="outline"
                  size="pill"
                  className={assigned ? "border-solid text-foreground" : "border-dashed text-muted-foreground"}
                />
              )}
              >
                <User aria-hidden="true" className={assigned ? "text-info" : undefined} />
                {assigneeLabel}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={assigneeMemberId} onValueChange={v => setAssigneeMemberId(v as string)}>
                  <DropdownMenuRadioItem value="__none__">{t("issues.unassigned")}</DropdownMenuRadioItem>
                  {members.map(m => (
                    <DropdownMenuRadioItem key={m.id} value={m.id}>{memberLabels.get(m.id) ?? m.id}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* A focusable pill button opens the native calendar via showPicker;
                the date input itself stays visually hidden but keeps the value. */}
            <div className="inline-flex items-center">
              <Button
                type="button"
                variant="outline"
                size="pill"
                className={cn("border", dueDate ? "border-solid text-foreground" : "border-dashed text-muted-foreground")}
                onClick={openDuePicker}
              >
                {dueDate || t("issues.field.dueDate")}
              </Button>
              <input
                ref={dueDateInputRef}
                type="date"
                value={dueDate}
                aria-label={t("issues.field.dueDate")}
                tabIndex={-1}
                onChange={e => setDueDate(e.target.value)}
                className="sr-only"
              />
            </div>

            {/* Attachment pill: stages files now, uploads them after the issue
                is created. The single attach affordance for the dialog. */}
            <Button
              type="button"
              variant="outline"
              size="pill"
              className={cn("border", files.length > 0 ? "border-solid text-foreground" : "border-dashed text-muted-foreground")}
              onClick={() => attachInputRef.current?.click()}
            >
              <Paperclip aria-hidden="true" className={files.length > 0 ? "text-info" : undefined} />
              {t("issues.composer.attach")}
              {files.length > 0 && <span className="tabular-nums">{`· ${files.length}`}</span>}
            </Button>
            <FileUploadButton
              inputRef={attachInputRef}
              accept="any"
              multiple
              onSelect={onPickFiles}
            />

            {/* Worklist pill: only while the `worklist` section is mounted. Opens the picker; a
                selected worklist switches it to the solid/foreground state and
                shows its name. Mirrors the attachment pill's styling/states. */}
            {canReferenceWorklists && (
              <Button
                type="button"
                variant="outline"
                size="pill"
                className={cn("border", selectedWorklist ? "border-solid text-foreground" : "border-dashed text-muted-foreground")}
                onClick={() => setWorklistPickerOpen(true)}
              >
                <ClipboardList aria-hidden="true" className={selectedWorklist ? "text-info" : undefined} />
                {selectedWorklist ? selectedWorklist.name : t("issues.worklist.button")}
              </Button>
            )}
          </div>

          {/* Removable reference chip — clearing it drops the reference but keeps
              the already-filled title/description. */}
          {selectedWorklist && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs">
                <span className="truncate">{`${t("issues.worklist.referenced")}: ${selectedWorklist.name}`}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("issues.worklist.remove")}
                  onClick={() => setSelectedWorklist(null)}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            </div>
          )}

          {/* Staged attachments: visible before submit so files can be removed.
              Cleared by reset() after a successful create. */}
          {files.length > 0 && (
            <ul className="space-y-1.5">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${file.size}-${index}`}
                  className="flex h-9 items-center gap-2 rounded-md border bg-card px-2.5"
                >
                  <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("issues.composer.removeAttachment")}
                    onClick={() => removeFile(index)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Sticky footer keeps the actions reachable when a long description
              scrolls the dialog body. Holds only the continue toggle + submit. */}
          <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 rounded-b-xl border-t bg-popover px-4 py-2.5">
            {/* Functional: keep the dialog open and reset after each create. */}
            <div className="flex items-center gap-1.5">
              <Switch id="issue-keep-open" size="sm" checked={keepOpen} onCheckedChange={setKeepOpen} />
              <Label htmlFor="issue-keep-open" className="text-xs font-normal text-muted-foreground">
                {t("issues.composer.continueCreate")}
              </Label>
            </div>
            <Button type="submit" disabled={createIssue.isPending || !title.trim()}>
              {t("issues.composer.submit")}
            </Button>
          </div>
        </form>

        {/* Worklist picker — only mounted with the `worklist` section. Portals out of
            this dialog, so it overlays cleanly on top of the composer. */}
        {canReferenceWorklists && (
          <WorklistPicker
            projectId={projectId}
            open={worklistPickerOpen}
            onOpenChange={setWorklistPickerOpen}
            onSelect={onSelectWorklist}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
