// Shared meta row for the issue and procurement detail panels. The two panels
// rendered a near-verbatim inline strip (status / priority badge-selects,
// assignee picker, due-date `showPicker` field, attachment + edit actions). This
// module factors that strip into composable primitives so both panels render an
// identical row while supplying their own data, localized labels, and mutation
// callbacks.

import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { ChevronDown, Paperclip, Pencil } from "lucide-react";
import { useRef } from "react";
import { FileUploadButton } from "@/shared/components/file";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

type BadgeVariant = "default" | "outline" | "secondary" | "destructive";

const NONE = "__none__";

// ── Container + spacing ──

export function DetailMetaRow({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {children}
    </div>
  );
}

export function MetaSeparator() {
  return <span className="mx-1 text-muted-foreground/50">·</span>;
}

// A `label:` prefix wrapping an inline value (assignee / due date).
function MetaField({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span>
        {label}
        :
      </span>
      {children}
    </span>
  );
}

// ── Status / priority: a Badge that becomes an inline Select when editable ──

interface MetaSelectBadgeProps<T extends string> {
  readonly canEdit: boolean;
  readonly value: T;
  readonly options: readonly T[];
  readonly renderLabel: (value: T) => React.ReactNode;
  readonly variant: BadgeVariant;
  /** Extra Badge classes for the current value (e.g. status color token). */
  readonly badgeClassName?: string;
  readonly triggerAriaLabel?: string;
  readonly onValueChange: (value: T) => void;
}

export function MetaSelectBadge<T extends string>({
  canEdit,
  value,
  options,
  renderLabel,
  variant,
  badgeClassName,
  triggerAriaLabel,
  onValueChange,
}: MetaSelectBadgeProps<T>) {
  if (!canEdit) {
    return (
      <Badge variant={variant} className={badgeClassName}>
        {renderLabel(value)}
      </Badge>
    );
  }

  return (
    <Select value={value} onValueChange={v => v !== null && onValueChange(v as T)}>
      <SelectTrigger
        className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 [&>svg:last-child]:size-3"
        aria-label={triggerAriaLabel}
      >
        <Badge variant={variant} className={cn("cursor-pointer", badgeClassName)}>
          {renderLabel(value)}
        </Badge>
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o} value={o}>{renderLabel(o)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Assignee: project-member picker ──

interface MetaAssigneeProps {
  readonly label: string;
  readonly unassignedLabel: string;
  readonly canEdit: boolean;
  readonly value: string | null;
  readonly members: readonly ProjectMemberView[];
  readonly memberLabels: ReadonlyMap<string, string>;
  readonly onChange: (next: string | null) => void;
}

export function MetaAssignee({
  label,
  unassignedLabel,
  canEdit,
  value,
  members,
  memberLabels,
  onChange,
}: MetaAssigneeProps) {
  const readonlyLabel = value ? memberLabels.get(value) ?? value : null;

  return (
    <MetaField label={label}>
      {canEdit
        ? (
            <Select
              value={value ?? NONE}
              onValueChange={(v) => {
                if (v === null)
                  return;
                onChange(v === NONE ? null : v);
              }}
            >
              <SelectTrigger className="h-auto border-0 bg-transparent p-0 shadow-none gap-1 text-xs text-foreground hover:text-primary [&>svg:last-child]:size-3">
                <SelectValue>
                  {(v: string) => {
                    if (v === NONE)
                      return <span className="text-muted-foreground">{unassignedLabel}</span>;
                    return memberLabels.get(v) ?? v;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{unassignedLabel}</SelectItem>
                {members.map(m => (
                  <SelectItem key={m.id} value={m.id}>{memberLabels.get(m.id) ?? m.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        : (
            <span className="text-foreground">
              {readonlyLabel ?? unassignedLabel}
            </span>
          )}
    </MetaField>
  );
}

// ── Due date: native date input revealed via `showPicker` ──

interface MetaDueDateProps {
  readonly label: string;
  readonly notSetLabel: string;
  readonly canEdit: boolean;
  readonly value: string | null;
  readonly onChange: (next: string | null) => void;
}

export function MetaDueDate({ label, notSetLabel, canEdit, value, onChange }: MetaDueDateProps) {
  const dateInputRef = useRef<HTMLInputElement>(null);

  return (
    <MetaField label={label}>
      {canEdit
        ? (
            <span className="relative inline-flex items-center">
              <Button
                type="button"
                variant="ghost"
                className="h-auto gap-1 rounded px-0 text-xs font-normal text-foreground hover:bg-transparent hover:text-primary"
                onClick={() => {
                  const input = dateInputRef.current;
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
                }}
                aria-label={label}
                title={label}
              >
                {value
                  ? <span>{value}</span>
                  : <span className="text-muted-foreground">{notSetLabel}</span>}
                <ChevronDown className="size-3" />
              </Button>
              <input
                ref={dateInputRef}
                type="date"
                className="sr-only"
                tabIndex={-1}
                value={value ?? ""}
                onChange={e => onChange(e.target.value || null)}
              />
            </span>
          )
        : <span className="text-foreground">{value ?? "—"}</span>}
    </MetaField>
  );
}

// ── Trailing actions: attachment upload + edit, plus the hidden file input ──

interface MetaActionsProps {
  readonly canUpload: boolean;
  readonly uploadPending: boolean;
  readonly uploadLabel: string;
  readonly uploadingLabel: string;
  readonly showEdit: boolean;
  readonly editLabel: string;
  readonly onEditClick: () => void;
  readonly fileInputRef: React.RefObject<HTMLInputElement | null>;
  readonly onFilesSelected: (files: File[]) => void;
}

export function MetaActions({
  canUpload,
  uploadPending,
  uploadLabel,
  uploadingLabel,
  showEdit,
  editLabel,
  onEditClick,
  fileInputRef,
  onFilesSelected,
}: MetaActionsProps) {
  return (
    <>
      <div className="ml-auto inline-flex items-center gap-0.5">
        {canUpload && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            title={uploadLabel}
          >
            <Paperclip className="size-3" />
            {uploadPending ? uploadingLabel : uploadLabel}
          </Button>
        )}
        {showEdit && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={onEditClick}
          >
            <Pencil className="size-3" />
            {editLabel}
          </Button>
        )}
      </div>
      <FileUploadButton
        inputRef={fileInputRef}
        accept="any"
        multiple
        onSelect={onFilesSelected}
      />
    </>
  );
}
