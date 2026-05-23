import type { FormEvent } from "react";
import type { DriveEntry, DriveOwnerType } from "@/shared/lib/api/drive";
import { ChevronRight, CornerLeftUp, Folder } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { CenteredHint } from "@/shared/components/ui/centered-hint";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useDriveEntries } from "@/shared/lib/api/drive";

interface DriveOwner {
  readonly ownerType: DriveOwnerType;
  readonly ownerId: string;
}

// Each dialog body lives in its own component so it mounts only while the
// dialog is open — base-ui unmounts the closed popup, which resets the form
// state on every open without a synchronizing effect.

// ── Create folder ──

interface CreateFolderDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly onCreate: (name: string) => void;
}

export function CreateFolderDialog({ open, onOpenChange, pending, onCreate }: CreateFolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CreateFolderForm pending={pending} onCreate={onCreate} />
      </DialogContent>
    </Dialog>
  );
}

function CreateFolderForm({ pending, onCreate }: { readonly pending: boolean; readonly onCreate: (name: string) => void }) {
  const { t } = useTranslation("drive");
  const [name, setName] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed)
      onCreate(trimmed);
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{t("browser.dialog.folderTitle")}</DialogTitle>
        <DialogDescription>{t("browser.dialog.folderDescription")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="drive-folder-name">{t("browser.dialog.nameLabel")}</Label>
        <Input
          id="drive-folder-name"
          autoFocus
          value={name}
          onChange={event => setName(event.currentTarget.value)}
          placeholder={t("browser.dialog.namePlaceholder")}
        />
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline">{t("common.cancel")}</Button>} />
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? t("common.saving") : t("browser.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Create text file ──

interface CreateTextFileDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  /** Markdown variant differs only in copy and the suggested filename. */
  readonly markdown?: boolean;
  readonly onCreate: (input: { readonly name: string }) => void;
}

export function CreateTextFileDialog({ open, onOpenChange, pending, markdown = false, onCreate }: CreateTextFileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <CreateTextFileForm pending={pending} markdown={markdown} onCreate={onCreate} />
      </DialogContent>
    </Dialog>
  );
}

/** Append the variant's extension unless the name already carries it. */
function withExtension(name: string, extension: string): string {
  return name.toLowerCase().endsWith(extension) ? name : `${name}${extension}`;
}

function CreateTextFileForm({
  pending,
  markdown,
  onCreate,
}: {
  readonly pending: boolean;
  readonly markdown: boolean;
  readonly onCreate: (input: { readonly name: string }) => void;
}) {
  const { t } = useTranslation("drive");
  const [name, setName] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed)
      onCreate({ name: withExtension(trimmed, markdown ? ".md" : ".txt") });
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{t(markdown ? "browser.dialog.markdownFileTitle" : "browser.dialog.textFileTitle")}</DialogTitle>
        <DialogDescription>{t(markdown ? "browser.dialog.markdownFileDescription" : "browser.dialog.textFileDescription")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="drive-text-name">{t("browser.dialog.nameLabel")}</Label>
        <Input
          id="drive-text-name"
          autoFocus
          value={name}
          onChange={event => setName(event.currentTarget.value)}
          placeholder={t(markdown ? "browser.dialog.markdownFileNamePlaceholder" : "browser.dialog.textFileNamePlaceholder")}
        />
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline">{t("common.cancel")}</Button>} />
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? t("common.saving") : t("browser.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Rename ──

interface RenameDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly entry: DriveEntry | null;
  readonly pending: boolean;
  readonly onRename: (name: string) => void;
}

export function RenameDialog({ open, onOpenChange, entry, pending, onRename }: RenameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {entry && <RenameForm initialName={entry.name} pending={pending} onRename={onRename} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  initialName,
  pending,
  onRename,
}: {
  readonly initialName: string;
  readonly pending: boolean;
  readonly onRename: (name: string) => void;
}) {
  const { t } = useTranslation("drive");
  const [name, setName] = useState(initialName);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed)
      onRename(trimmed);
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{t("browser.dialog.renameTitle")}</DialogTitle>
        <DialogDescription>{t("browser.dialog.renameDescription")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="drive-rename">{t("browser.dialog.nameLabel")}</Label>
        <Input
          id="drive-rename"
          autoFocus
          value={name}
          onChange={event => setName(event.currentTarget.value)}
          placeholder={t("browser.dialog.namePlaceholder")}
        />
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline">{t("common.cancel")}</Button>} />
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Move ──

interface MoveDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly entry: DriveEntry | null;
  readonly owner: DriveOwner;
  readonly pending: boolean;
  readonly onMove: (parentEntryId: string | null) => void;
}

export function MoveDialog({ open, onOpenChange, entry, owner, pending, onMove }: MoveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {entry && <MoveForm entry={entry} owner={owner} pending={pending} onMove={onMove} />}
      </DialogContent>
    </Dialog>
  );
}

interface MoveCrumb {
  readonly id: string | null;
  readonly name: string;
}

/**
 * Folder picker for relocating an entry. Browses the owner's folder tree
 * (folders only) starting at root and moves the entry into whichever folder
 * the user is currently viewing. The moving entry is hidden so it cannot be
 * dropped into itself.
 */
function MoveForm({
  entry,
  owner,
  pending,
  onMove,
}: {
  readonly entry: DriveEntry;
  readonly owner: DriveOwner;
  readonly pending: boolean;
  readonly onMove: (parentEntryId: string | null) => void;
}) {
  const { t } = useTranslation("drive");
  const [stack, setStack] = useState<readonly MoveCrumb[]>([]);

  const currentParentId = stack.at(-1)?.id ?? null;
  const entriesQuery = useDriveEntries(currentParentId, "normal", owner);

  const folders = (entriesQuery.data ?? []).filter(
    item => item.type === "folder" && item.id !== entry.id,
  );

  const sameLocation = (entry.parentEntryId ?? null) === currentParentId;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("browser.dialog.moveTitle")}</DialogTitle>
        <DialogDescription>{t("browser.dialog.moveDescription", { name: entry.name })}</DialogDescription>
      </DialogHeader>

      <nav aria-label={t("browser.dialog.moveTitle")} className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <button
          type="button"
          className="rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => setStack([])}
        >
          {t("browser.breadcrumbRoot")}
        </button>
        {stack.map((crumb, index) => (
          <span key={crumb.id ?? "root"} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="size-3.5 shrink-0" />
            <button
              type="button"
              className="truncate rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => setStack(prev => prev.slice(0, index + 1))}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="max-h-64 min-h-32 overflow-auto rounded-lg border border-border">
        {currentParentId !== null && (
          <button
            type="button"
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            onClick={() => setStack(prev => prev.slice(0, -1))}
          >
            <CornerLeftUp className="size-4 shrink-0 text-muted-foreground" />
            {t("browser.dialog.moveUp")}
          </button>
        )}
        {entriesQuery.isLoading
          ? <CenteredHint className="py-8">{t("common.loading")}</CenteredHint>
          : folders.length === 0
            ? <CenteredHint className="py-8">{t("browser.dialog.moveNoFolders")}</CenteredHint>
            : folders.map(folder => (
                <button
                  key={folder.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() => setStack(prev => [...prev, { id: folder.id, name: folder.name }])}
                >
                  <Folder className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
      </div>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline">{t("common.cancel")}</Button>} />
        <Button type="button" disabled={pending || sameLocation} onClick={() => onMove(currentParentId)}>
          {pending ? t("common.saving") : t("browser.dialog.moveHere")}
        </Button>
      </DialogFooter>
    </>
  );
}
