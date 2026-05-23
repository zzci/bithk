// Flat view-nav sidebar for the drive page, styled to match the documents
// page sidebar. Fixed views switch the main pane; the Team section lists the
// user's team directories inline — selecting one opens its file browser
// directly (the content reuses the shared surface, no separate list page).

import type { ChangeEvent } from "react";
import type { EditState } from "./-team-directory-list";
import type { DriveEntry, TeamDirectory } from "@/shared/lib/api/drive";
import {
  Clock,
  FilePlus2,
  FolderCog,
  FolderPlus,
  HardDrive,
  MoreHorizontal,
  Pencil,
  Plus,
  Share2,
  Star,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  useCreateDriveFolder,
  useCreateTextFile,
  useDeleteTeamDirectory,
  useTeamDirectories,
} from "@/shared/lib/api/drive";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { useDriveUploader } from "./-drive-upload";
import { CreateFolderDialog, CreateTextFileDialog } from "./-entry-create-dialogs";
import { DirectoryEditDialog } from "./-team-directory-list";
import { TeamDirectoryMembersPanel } from "./-team-directory-members";

export type DriveView
  = | "my-files"
    | "recent"
    | "favorites"
    | "trash"
    | "shared-with-me"
    | "shared-by-me";

interface NavItem {
  readonly view: DriveView;
  readonly icon: typeof HardDrive;
  readonly labelKey: string;
}

interface NavSection {
  readonly labelKey: string;
  readonly items: readonly NavItem[];
}

const SECTIONS: readonly NavSection[] = [
  {
    labelKey: "sidebar.section.files",
    items: [
      { view: "my-files", icon: HardDrive, labelKey: "sidebar.myFiles" },
      { view: "recent", icon: Clock, labelKey: "sidebar.recent" },
      { view: "favorites", icon: Star, labelKey: "sidebar.favorites" },
      { view: "trash", icon: Trash2, labelKey: "sidebar.trash" },
    ],
  },
  {
    labelKey: "sidebar.section.shared",
    items: [
      { view: "shared-with-me", icon: Share2, labelKey: "sidebar.sharedWithMe" },
      { view: "shared-by-me", icon: Upload, labelKey: "sidebar.sharedByMe" },
    ],
  },
];

const NAV_ITEM_CLASS = "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors";

export function DriveSidebar({
  activeView,
  onSelect,
  activeTeamDirId,
  onSelectTeamDir,
  onOpenEntry,
}: {
  readonly activeView: DriveView | null;
  readonly onSelect: (view: DriveView) => void;
  readonly activeTeamDirId: string | null;
  readonly onSelectTeamDir: (directory: TeamDirectory) => void;
  readonly onOpenEntry?: (entry: DriveEntry, edit?: boolean) => void;
}) {
  const { t } = useTranslation("drive");
  const user = useAuthStore(s => s.user);

  // The "+" creates into the personal drive root. Land the user on My files
  // so the new entry/upload is visible.
  const createFolder = useCreateDriveFolder();
  const createTextFile = useCreateTextFile();
  const enqueueUploads = useDriveUploader();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dialog, setDialog] = useState<"folder" | "text" | null>(null);

  // Team directory management is hosted here since the section is the only
  // place team directories are listed now.
  const dirsQuery = useTeamDirectories();
  const directories = dirsQuery.data ?? [];
  const deleteDirectory = useDeleteTeamDirectory();
  const [edit, setEdit] = useState<EditState>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamDirectory | null>(null);
  const [membersDir, setMembersDir] = useState<TeamDirectory | null>(null);

  const rootOwner = user ? { ownerType: "user" as const, ownerId: user.id, parentEntryId: null } : null;

  const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    const list = files ? Array.from(files) : [];
    event.currentTarget.value = "";
    if (list.length > 0 && rootOwner) {
      enqueueUploads(list, rootOwner);
      onSelect("my-files");
    }
  };

  // Outer chrome (width / bg-muted / border-r) is owned by the page wrapper
  // so the same content works in both the inline desktop column and the
  // mobile slide-in Sheet.
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      <div className="flex h-[45px] shrink-0 items-center gap-1 border-b border-border px-4">
        <h2 className="flex-1 truncate text-base font-semibold tracking-tight">
          {t("page.title")}
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(
              <Button variant="default" size="icon-sm" disabled={!user} aria-label={t("browser.create")} />
            )}
          >
            <Plus className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-2 size-4" />
              {t("browser.upload")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialog("folder")}>
              <FolderPlus className="mr-2 size-4" />
              {t("browser.newFolder")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialog("text")}>
              <FilePlus2 className="mr-2 size-4" />
              {t("browser.newTextFile")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onUploadInputChange}
      />

      <CreateFolderDialog
        open={dialog === "folder"}
        onOpenChange={open => !open && setDialog(null)}
        pending={createFolder.isPending}
        onCreate={(name) => {
          if (!rootOwner)
            return;
          createFolder.mutate({ name, ...rootOwner }, {
            onSuccess: () => {
              setDialog(null);
              onSelect("my-files");
            },
          });
        }}
      />
      <CreateTextFileDialog
        open={dialog === "text"}
        onOpenChange={open => !open && setDialog(null)}
        pending={createTextFile.isPending}
        onCreate={({ name }) => {
          if (!rootOwner)
            return;
          createTextFile.mutate({ name, content: "", ...rootOwner }, {
            onSuccess: (entry) => {
              setDialog(null);
              onSelect("my-files");
              onOpenEntry?.(entry, true);
            },
          });
        }}
      />

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2" aria-label={t("page.title")}>
        {SECTIONS.map(section => (
          <div key={section.labelKey} className="mb-2">
            <div className="px-4 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {t(section.labelKey)}
            </div>
            <ul>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.view;
                return (
                  <li key={item.view}>
                    <button
                      type="button"
                      onClick={() => onSelect(item.view)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        NAV_ITEM_CLASS,
                        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/40",
                      )}
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <span className="flex-1 truncate">{t(item.labelKey)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* Team directories listed inline; selecting one opens its browser. */}
        <div className="mb-2">
          <div className="flex items-center justify-between gap-1 px-4 py-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {t("sidebar.section.team")}
            </span>
            <button
              type="button"
              onClick={() => setEdit({ type: "create" })}
              disabled={!user}
              aria-label={t("team.list.create")}
              title={t("team.list.create")}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <ul>
            {directories.length === 0 && (
              <li className="px-4 py-1 text-xs text-muted-foreground/60">{t("team.empty")}</li>
            )}
            {directories.map((directory) => {
              const isActive = activeTeamDirId === directory.id;
              return (
                <li key={directory.id} className="group/dir relative">
                  <button
                    type="button"
                    onClick={() => onSelectTeamDir(directory)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      NAV_ITEM_CLASS,
                      "pr-8",
                      isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/40",
                    )}
                  >
                    <FolderCog className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="flex-1 truncate">{directory.name}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={(
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("team.col.actions")}
                          className="absolute top-1/2 right-2 size-6 -translate-y-1/2 opacity-0 transition-opacity group-hover/dir:opacity-100 data-[popup-open]:opacity-100"
                        />
                      )}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      <DropdownMenuItem onClick={() => setMembersDir(directory)}>
                        <Users className="mr-2 size-4" />
                        {t("team.action.members")}
                      </DropdownMenuItem>
                      {directory.role === "admin" && (
                        <>
                          <DropdownMenuItem onClick={() => setEdit({ type: "rename", directory })}>
                            <Pencil className="mr-2 size-4" />
                            {t("team.action.rename")}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(directory)}>
                            <Trash2 className="mr-2 size-4" />
                            {t("team.action.delete")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      <DirectoryEditDialog state={edit} onClose={() => setEdit(null)} />
      {membersDir && (
        <TeamDirectoryMembersPanel
          directoryId={membersDir.id}
          open
          onOpenChange={open => !open && setMembersDir(null)}
        />
      )}
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title={t("team.delete.title")}
        description={t("team.delete.description", { name: deleteTarget?.name ?? "" })}
        pending={deleteDirectory.isPending}
        onConfirm={() => {
          if (!deleteTarget)
            return;
          deleteDirectory.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
        }}
      />
    </div>
  );
}
