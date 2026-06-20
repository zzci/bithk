// Flat view-nav sidebar for the drive page, styled to match the documents
// page sidebar. Fixed views switch the main pane; the Team section lists the
// user's team directories inline — selecting one opens its file browser
// directly (the content reuses the shared surface, no separate list page).

import type { EditState } from "./-team-directory-list";
import type { DriveEntry, TeamDirectory } from "@/shared/lib/api/drive";
import type { ProjectView } from "@/shared/lib/api/projects";
import {
  Clock,
  FilePlus2,
  FolderCog,
  FolderPlus,
  HardDrive,
  Layers,
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

import { FileUploadButton, useFileUploader } from "@/shared/components/file";
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
import { useProjects } from "@/shared/lib/api/projects";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
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
  activeProjectId,
  onSelectProject,
  onOpenEntry,
}: {
  readonly activeView: DriveView | null;
  readonly onSelect: (view: DriveView) => void;
  readonly activeTeamDirId: string | null;
  readonly onSelectTeamDir: (directory: TeamDirectory) => void;
  readonly activeProjectId: string | null;
  readonly onSelectProject: (project: ProjectView) => void;
  readonly onOpenEntry?: (entry: DriveEntry, edit?: boolean) => void;
}) {
  const { t } = useTranslation("drive");
  const user = useAuthStore(s => s.user);

  // The "+" creates into the personal drive root. Land the user on My files
  // so the new entry/upload is visible.
  const createFolder = useCreateDriveFolder();
  const createTextFile = useCreateTextFile();
  const enqueueUploads = useFileUploader();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dialog, setDialog] = useState<"folder" | "text" | null>(null);

  // Team directory management is hosted here since the section is the only
  // place team directories are listed now.
  const dirsQuery = useTeamDirectories();
  const directories = dirsQuery.data ?? [];
  const deleteDirectory = useDeleteTeamDirectory();

  // Projects the current user can access (membership-filtered server-side).
  // Selecting one opens its project-scoped file browser in the main pane.
  const projectsQuery = useProjects();
  const projects = projectsQuery.data?.data ?? [];
  const [edit, setEdit] = useState<EditState>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamDirectory | null>(null);
  const [membersDir, setMembersDir] = useState<TeamDirectory | null>(null);

  const rootOwner = user ? { ownerType: "user" as const, ownerId: user.id, parentEntryId: null } : null;

  const onUploadInputChange = (list: File[]) => {
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
              <Button variant="default" size="icon" disabled={!user} aria-label={t("browser.create")} />
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

      <FileUploadButton
        inputRef={fileInputRef}
        accept="any"
        multiple
        onSelect={onUploadInputChange}
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
            <div className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              {t(section.labelKey)}
            </div>
            <ul>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.view;
                return (
                  <li key={item.view}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onSelect(item.view)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        NAV_ITEM_CLASS,
                        "h-auto justify-start font-normal",
                        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/40",
                      )}
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <span className="flex-1 truncate">{t(item.labelKey)}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* Team directories listed inline; selecting one opens its browser. */}
        <div className="mb-2">
          <div className="flex items-center justify-between gap-1 px-4 py-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              {t("sidebar.section.team")}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setEdit({ type: "create" })}
              disabled={!user}
              aria-label={t("team.list.create")}
              title={t("team.list.create")}
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <ul>
            {directories.length === 0 && (
              <li className="px-4 py-1 text-xs text-muted-foreground/60">{t("team.empty")}</li>
            )}
            {directories.map((directory) => {
              const isActive = activeTeamDirId === directory.id;
              return (
                <li key={directory.id} className="group/dir relative">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onSelectTeamDir(directory)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      NAV_ITEM_CLASS,
                      "h-auto justify-start pr-8 font-normal",
                      isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/40",
                    )}
                  >
                    <FolderCog className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="flex-1 truncate">{directory.name}</span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={(
                        <Button
                          variant="ghost"
                          size="icon-xs"
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

        {/* Accessible projects listed inline; selecting one opens its files. */}
        <div className="mb-2">
          <div className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            {t("sidebar.section.projects")}
          </div>
          <ul>
            {projects.length === 0 && (
              <li className="px-4 py-1 text-xs text-muted-foreground/60">{t("sidebar.projectsEmpty")}</li>
            )}
            {projects.map((project) => {
              const isActive = activeProjectId === project.id;
              return (
                <li key={project.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onSelectProject(project)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      NAV_ITEM_CLASS,
                      "h-auto justify-start font-normal",
                      isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/40",
                    )}
                  >
                    <Layers className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="flex-1 truncate">{project.name}</span>
                  </Button>
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
