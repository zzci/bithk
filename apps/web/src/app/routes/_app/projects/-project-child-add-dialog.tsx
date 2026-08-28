// "Add a sub-project" picker: two modes inside a tabbed dialog.
//   (a) "existing" — search projects and link one as a child.
//   (b) "create"   — create a new project already parented to this one.
// Both rely on the mutations' onSuccess invalidation to refresh the children
// list. Gated on `canManage` at the call site.
//
// The hierarchy is one level deep, so the API rejects a candidate that is
// already a child or already has children (422). `ProjectView` carries no
// parent link, so that can only be surfaced from the response, not filtered
// out client-side.

import type { ProjectView } from "@/shared/lib/api/projects";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { EmptyHint } from "@/shared/components/ui/centered-hint";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useCreateProjectChild, useLinkProjectChild, useProjects } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";

interface ProjectChildAddDialogProps {
  readonly parentId: string;
  /** Ids already linked to this parent — excluded from the candidate list. */
  readonly linkedIds: readonly string[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ProjectChildAddDialog({
  parentId,
  linkedIds,
  open,
  onOpenChange,
}: ProjectChildAddDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const projectsQuery = useProjects({ q: debouncedSearch.trim() || undefined, limit: 50 });
  const link = useLinkProjectChild();
  const createChild = useCreateProjectChild();

  /* eslint-disable react/set-state-in-effect -- reset the picker fields whenever
     the dialog opens so a previous draft never leaks into a fresh session. */
  useEffect(() => {
    if (!open)
      return;
    setSearch("");
    setName("");
    setCode("");
  }, [open]);
  /* eslint-enable react/set-state-in-effect */

  // The parent itself and its existing children are never candidates.
  const candidates = (projectsQuery.data?.data ?? []).filter(
    p => p.id !== parentId && !linkedIds.includes(p.id),
  );

  const onLinked = () => {
    toast.success(t("subProjects.bound"));
    onOpenChange(false);
  };
  const onLinkError = (e: unknown) =>
    toast.error(errorMessage(e, t("common:common.error.operationFailed")));

  const linkExisting = (project: ProjectView) => {
    if (link.isPending)
      return;
    link.mutate({ parentId, childId: project.id }, { onSuccess: onLinked, onError: onLinkError });
  };

  const createAndLink = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || createChild.isPending || link.isPending)
      return;
    createChild.mutate(
      { parentId, name: name.trim(), code: code.trim() || null },
      { onSuccess: onLinked, onError: onLinkError },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("subProjects.pickerTitle")}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="existing">
          <TabsList variant="line">
            <TabsTrigger value="existing">{t("subProjects.bindFromExisting")}</TabsTrigger>
            <TabsTrigger value="create">{t("subProjects.bindCreateNew")}</TabsTrigger>
          </TabsList>

          <TabsContent value="existing" className="space-y-3">
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("subProjects.searchPlaceholder")}
            />
            {candidates.length === 0
              ? <EmptyHint py="sm">{t("subProjects.noCandidates")}</EmptyHint>
              : (
                  <ul className="max-h-64 space-y-1 overflow-y-auto">
                    {candidates.map(project => (
                      <li
                        key={project.id}
                        className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{project.name}</p>
                          {project.code && <p className="truncate font-mono text-xs text-muted-foreground">{project.code}</p>}
                        </div>
                        <Button size="sm" onClick={() => linkExisting(project)} disabled={link.isPending}>
                          {t("subProjects.bind")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
          </TabsContent>

          <TabsContent value="create">
            <form onSubmit={createAndLink} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="project-child-new-name">{t("subProjects.newName")}</Label>
                <Input
                  id="project-child-new-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-child-new-code">{t("subProjects.newCode")}</Label>
                <Input
                  id="project-child-new-code"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={!name.trim() || createChild.isPending || link.isPending}>
                  {t("subProjects.bind")}
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
