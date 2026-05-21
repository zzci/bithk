/* eslint-disable react-refresh/only-export-components */
import type { DriveEntry, TeamDirectory } from "@/shared/lib/api/drive";
import { createLazyFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { useTeamDirectory } from "@/shared/lib/api/drive";
import { useAuthStore } from "@/shared/stores/auth";

import { FileBrowser } from "./-file-browser";
import { FilePreviewDialog } from "./-file-preview-dialog";
import { ShareDialog } from "./-share-dialog";
import { PublicLinksList, ReceivedSharesList, SentSharesList } from "./-share-lists";
import { ManageMembersButton, TeamDirectoryList } from "./-team-directory-list";

export const Route = createLazyFileRoute("/_app/portal/drive")({
  component: DrivePage,
});

function DrivePage() {
  const { t } = useTranslation("drive");
  const user = useAuthStore(s => s.user);

  // Page-level dialog targets, driven by the FileBrowser callbacks across tabs.
  const [shareEntry, setShareEntry] = useState<DriveEntry | null>(null);
  const [previewEntry, setPreviewEntry] = useState<DriveEntry | null>(null);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 md:px-6">
        <h1 className="text-base font-semibold tracking-tight">{t("page.title")}</h1>
      </header>

      <Tabs defaultValue="my-files" className="min-h-0 flex-1 gap-3 px-4 py-3 md:px-6">
        <TabsList>
          <TabsTrigger value="my-files">{t("page.tab.myFiles")}</TabsTrigger>
          <TabsTrigger value="team">{t("page.tab.teamDirectories")}</TabsTrigger>
          <TabsTrigger value="shared">{t("page.tab.sharedWithMe")}</TabsTrigger>
        </TabsList>

        <TabsContent value="my-files" className="min-h-0">
          {user && (
            <FileBrowser
              ownerType="user"
              ownerId={user.id}
              onShareEntry={setShareEntry}
              onPreviewEntry={setPreviewEntry}
            />
          )}
        </TabsContent>

        <TabsContent value="team" className="min-h-0 overflow-auto">
          <TeamDirectoriesTab onShareEntry={setShareEntry} onPreviewEntry={setPreviewEntry} />
        </TabsContent>

        <TabsContent value="shared" className="min-h-0 overflow-auto">
          <SharedTab />
        </TabsContent>
      </Tabs>

      {shareEntry && (
        <ShareDialog
          entry={shareEntry}
          open
          onOpenChange={open => !open && setShareEntry(null)}
        />
      )}
      {previewEntry && (
        <FilePreviewDialog
          entry={previewEntry}
          open
          onOpenChange={open => !open && setPreviewEntry(null)}
        />
      )}
    </div>
  );
}

interface TabCallbacks {
  readonly onShareEntry: (entry: DriveEntry) => void;
  readonly onPreviewEntry: (entry: DriveEntry) => void;
}

function TeamDirectoriesTab({ onShareEntry, onPreviewEntry }: TabCallbacks) {
  const [activeDir, setActiveDir] = useState<TeamDirectory | null>(null);

  if (!activeDir)
    return <TeamDirectoryList onOpenDirectory={setActiveDir} />;

  return (
    <TeamDirectoryView
      directory={activeDir}
      onBack={() => setActiveDir(null)}
      onShareEntry={onShareEntry}
      onPreviewEntry={onPreviewEntry}
    />
  );
}

function TeamDirectoryView({
  directory,
  onBack,
  onShareEntry,
  onPreviewEntry,
}: TabCallbacks & {
  readonly directory: TeamDirectory;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation("drive");
  // Re-fetch the directory so the role gate reflects the latest membership.
  const dirQuery = useTeamDirectory(directory.id);
  const current = dirQuery.data ?? directory;
  const canManage = current.role === "admin" || current.role === "editor";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t("page.team.back")}
        </Button>
        <span className="min-w-0 truncate text-sm font-medium">{current.name}</span>
        {current.role === "admin" && (
          <span className="ml-auto">
            <ManageMembersButton directory={current} />
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <FileBrowser
          ownerType="team_directory"
          ownerId={directory.id}
          canManage={canManage}
          onShareEntry={onShareEntry}
          onPreviewEntry={onPreviewEntry}
        />
      </div>
    </div>
  );
}

function SharedTab() {
  const { t } = useTranslation("drive");
  return (
    <Tabs defaultValue="received" className="gap-3">
      <TabsList>
        <TabsTrigger value="received">{t("page.shared.received")}</TabsTrigger>
        <TabsTrigger value="sent">{t("page.shared.sent")}</TabsTrigger>
        <TabsTrigger value="links">{t("page.shared.links")}</TabsTrigger>
      </TabsList>
      <TabsContent value="received">
        <ReceivedSharesList />
      </TabsContent>
      <TabsContent value="sent">
        <SentSharesList />
      </TabsContent>
      <TabsContent value="links">
        <PublicLinksList />
      </TabsContent>
    </Tabs>
  );
}
