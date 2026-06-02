// Projects tab: the ship's base project plus any additionally bound projects.
// The base project is the ship's permission and file anchor and cannot be
// unbound. Binding/unbinding is gated on `canManage`.

import type { ShipProjectView, ShipView } from "@/shared/lib/api/ships";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, Info, Link2Off } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import {
  useBindShipProject,
  useShipProjects,
  useUnbindShipProject,
} from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";

interface ShipProjectsTabProps {
  readonly ship: ShipView;
  readonly canManage: boolean;
}

export function ShipProjectsTab({ ship, canManage }: ShipProjectsTabProps) {
  const { t } = useTranslation(["ships", "projects", "common"]);
  const navigate = useNavigate();

  const projectsQuery = useShipProjects(ship.id);
  const bind = useBindShipProject();
  const unbind = useUnbindShipProject();

  const [bindValue, setBindValue] = useState("");
  const [unbindTarget, setUnbindTarget] = useState<ShipProjectView | null>(null);

  const projects = projectsQuery.data ?? [];

  const handleBind = () => {
    const projectShortId = bindValue.trim();
    if (!projectShortId || bind.isPending)
      return;
    bind.mutate({ shipId: ship.id, projectShortId }, { onSuccess: () => setBindValue("") });
  };

  const handleUnbind = () => {
    if (!unbindTarget)
      return;
    unbind.mutate(
      { shipId: ship.id, projectShortId: unbindTarget.id },
      { onSuccess: () => setUnbindTarget(null) },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>{t("projects.callout")}</p>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="ship-bind-project" className="text-sm text-muted-foreground">
              {t("projects.bindTitle")}
            </label>
            <Input
              id="ship-bind-project"
              value={bindValue}
              onChange={e => setBindValue(e.target.value)}
              placeholder={t("projects.bindPlaceholder")}
            />
          </div>
          <Button onClick={handleBind} disabled={!bindValue.trim() || bind.isPending}>
            {t("projects.bind")}
          </Button>
        </div>
      )}

      {bind.error && <ErrorBanner message={errorMessage(bind.error, t("common:common.error.operationFailed"))} />}
      {unbind.error && <ErrorBanner message={errorMessage(unbind.error, t("common:common.error.operationFailed"))} />}
      {projectsQuery.error && <ErrorBanner message={errorMessage(projectsQuery.error, t("common:common.error.loadFailed"))} />}

      {projectsQuery.isLoading
        ? <p className="text-sm text-muted-foreground">{t("common:common.loading")}</p>
        : projects.length === 0
          ? <p className="text-sm text-muted-foreground">{t("projects.empty")}</p>
          : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {projects.map(project => (
                  <div key={project.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">{project.name}</span>
                          {project.isBase && <Badge variant="secondary" className="text-xs">{t("projects.baseBadge")}</Badge>}
                        </div>
                        {project.code && <p className="truncate font-mono text-xs text-muted-foreground">{project.code}</p>}
                      </div>
                      {project.status && (
                        <Badge variant="outline" className="shrink-0 text-xs">{t(`projects:status.${project.status}` as const)}</Badge>
                      )}
                    </div>
                    {project.description && <p className="line-clamp-2 text-xs text-muted-foreground">{project.description}</p>}
                    {(project.tags?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {project.tags.slice(0, 4).map(tag => <Badge key={tag.id} variant="outline" className="text-xs">{tag.name}</Badge>)}
                      </div>
                    )}
                    <div className="flex items-center gap-1 border-t border-dashed pt-2">
                      <Button
                        variant="ghost"
                        onClick={() => void navigate({ to: "/projects/$projectId/from/$shipId", params: { projectId: project.id, shipId: ship.id } })}
                      >
                        <ExternalLink className="mr-1 size-4" />
                        {t("projects.open")}
                      </Button>
                      {canManage && !project.isBase && (
                        <Button variant="ghost" onClick={() => setUnbindTarget(project)}>
                          <Link2Off className="mr-1 size-4 text-destructive" />
                          {t("projects.unbind")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

      <ConfirmDeleteDialog
        open={unbindTarget !== null}
        onOpenChange={open => !open && setUnbindTarget(null)}
        title={t("projects.unbindTitle")}
        description={t("projects.unbindConfirm", { name: unbindTarget?.name ?? "" })}
        confirmLabel={t("projects.unbind")}
        pending={unbind.isPending}
        onConfirm={handleUnbind}
      />
    </div>
  );
}
