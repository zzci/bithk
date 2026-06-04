// Ship "bind a project" picker: two modes inside a tabbed dialog.
//   (a) "existing" — search the fleet's unbound projects and bind one.
//   (b) "create"   — create a new project and auto-bind it to the ship.
// Both modes rely on useBindShipProject's onSuccess invalidation to refresh the
// ship's project list. Gated on `canManage` at the call site.

import type { ProjectView } from "@/shared/lib/api/projects";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
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
import { useCreateProject, useProjects } from "@/shared/lib/api/projects";
import { useBindShipProject } from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";

interface ShipProjectBindDialogProps {
  readonly shipId: string;
  /** Ids already bound to this ship — excluded from the candidate list. */
  readonly boundProjectIds: readonly string[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ShipProjectBindDialog({
  shipId,
  boundProjectIds,
  open,
  onOpenChange,
}: ShipProjectBindDialogProps) {
  const { t } = useTranslation(["ships", "projects", "common"]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const projectsQuery = useProjects({ q: debouncedSearch.trim() || undefined, limit: 50 });
  const bind = useBindShipProject();
  const createProject = useCreateProject();

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

  // Only projects without a ship and not already bound are bindable candidates.
  const candidates = (projectsQuery.data?.data ?? []).filter(
    p => !p.shipId && !boundProjectIds.includes(p.id),
  );

  const onBound = () => {
    toast.success(t("projects.bound"));
    onOpenChange(false);
  };
  const onBindError = (e: unknown) =>
    toast.error(errorMessage(e, t("common:common.error.operationFailed")));

  const bindExisting = (project: ProjectView) => {
    if (bind.isPending)
      return;
    bind.mutate({ shipId, projectShortId: project.id }, { onSuccess: onBound, onError: onBindError });
  };

  const createAndBind = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || createProject.isPending || bind.isPending)
      return;
    createProject.mutate(
      { name: name.trim(), code: code.trim() || null },
      {
        onSuccess: newProject =>
          bind.mutate({ shipId, projectShortId: newProject.id }, { onSuccess: onBound, onError: onBindError }),
        onError: onBindError,
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("projects.pickerTitle")}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="existing">
          <TabsList variant="line">
            <TabsTrigger value="existing">{t("projects.bindFromExisting")}</TabsTrigger>
            <TabsTrigger value="create">{t("projects.bindCreateNew")}</TabsTrigger>
          </TabsList>

          <TabsContent value="existing" className="space-y-3">
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("projects.searchPlaceholder")}
            />
            {candidates.length === 0
              ? <p className="py-6 text-center text-sm text-muted-foreground">{t("projects.noCandidates")}</p>
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
                        <Button size="sm" onClick={() => bindExisting(project)} disabled={bind.isPending}>
                          {t("projects.bind")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
          </TabsContent>

          <TabsContent value="create">
            <form onSubmit={createAndBind} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ship-bind-new-name">{t("projects.newName")}</Label>
                <Input
                  id="ship-bind-new-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ship-bind-new-code">{t("projects.newCode")}</Label>
                <Input
                  id="ship-bind-new-code"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={!name.trim() || createProject.isPending || bind.isPending}>
                  {t("projects.bind")}
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
