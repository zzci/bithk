/* eslint-disable react-refresh/only-export-components */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { FavoriteItem } from "@/shared/lib/api/favorites";
import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { ClipboardList, FileText, FolderKanban, ShoppingCart, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FavoriteToggle } from "@/shared/components/favorite-toggle";
import { PageHeader } from "@/shared/components/page-header";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { useFavorites, useOverview, useToggleFavorite } from "@/shared/lib/api/favorites";
import { formatMoney } from "@/shared/lib/format";
import { ISSUE_STATUS_BADGE, PROCUREMENT_STATUS_BADGE, RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";
import { useAuthStore } from "@/shared/stores/auth";

export const Route = createLazyFileRoute("/_app/overview")({
  component: OverviewPage,
});

// Quick-nav fallback tiles for callers without the projects module (the
// workbench sections are all projects-module content). Descriptions resolve
// to `overview.tile.<key>Description` and titles to `nav.<key>` in i18n.
interface OverviewTile {
  readonly key: string;
  readonly path: string;
  readonly icon: LucideIcon;
  /** Module gate; the tile renders only when the user holds the module. */
  readonly module: string;
}

const OVERVIEW_TILES: readonly OverviewTile[] = [
  { key: "projects", path: "/projects", icon: FolderKanban, module: "projects" },
  { key: "documents", path: "/documents", icon: FileText, module: "documents" },
];

function OverviewPage() {
  const { t } = useTranslation(["common", "overview"]);
  const user = useAuthStore(s => s.user);
  const hasProjects = user?.modules?.includes("projects") ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("overview:welcome", { name: user?.name ?? user?.username ?? "" })}
        description={t("overview:page.description")}
      />
      {hasProjects ? <OverviewWorkbench /> : <OverviewTiles modules={user?.modules ?? []} />}
    </div>
  );
}

function OverviewTiles({ modules }: { readonly modules: readonly string[] }) {
  const { t } = useTranslation(["common", "overview"]);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {OVERVIEW_TILES.filter(tile => modules.includes(tile.module)).map(tile => (
        <Link key={tile.key} to={tile.path}>
          <Card size="sm" className="h-full cursor-pointer transition-colors hover:bg-muted/50">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <tile.icon className="size-5" />
                </div>
                <div>
                  <CardTitle className="text-sm">{t(`nav.${tile.key}`)}</CardTitle>
                  <CardDescription className="text-xs">
                    {t(`overview:tile.${tile.key}Description`)}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}

const FAVORITE_ICONS: Record<FavoriteItem["targetType"], LucideIcon> = {
  project: FolderKanban,
  issue: ClipboardList,
  procurement: ShoppingCart,
};

function OverviewWorkbench() {
  const { t } = useTranslation(["overview", "common", "projects"]);
  const favoritesQuery = useFavorites();
  const overviewQuery = useOverview();
  const toggleFavorite = useToggleFavorite();

  const favorites = favoritesQuery.data ?? [];
  const myIssues = overviewQuery.data?.myIssues ?? [];
  const openProcurements = overviewQuery.data?.openProcurements ?? [];

  const favoriteBadge = (f: FavoriteItem): { className: string; label: string } => {
    switch (f.targetType) {
      case "project":
        return {
          className: RECORD_STATUS_BADGE[f.status],
          label: t(`projects:status.${f.status}` as const),
        };
      case "issue":
        return {
          className: ISSUE_STATUS_BADGE[f.status],
          label: t(`projects:issues.status.${f.status}` as const),
        };
      case "procurement":
        return {
          className: PROCUREMENT_STATUS_BADGE[f.status],
          label: t(`projects:procurement.status.${f.status}` as const),
        };
    }
  };

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Star className="size-4 text-amber-500" aria-hidden="true" />
            {t("overview:favorites.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {favorites.length === 0
            ? (
                <p className="text-sm text-muted-foreground">
                  {t("overview:favorites.empty")}
                  {" "}
                  <Link to="/projects" className="text-primary underline-offset-4 hover:underline">
                    {t("overview:favorites.browseProjects")}
                  </Link>
                </p>
              )
            : (
                <ul className="flex flex-col">
                  {favorites.map((f) => {
                    const Icon = FAVORITE_ICONS[f.targetType];
                    const badge = favoriteBadge(f);
                    const title = f.targetType === "project" ? f.name : f.targetType === "issue" ? f.title : f.itemName;
                    return (
                      <li key={`${f.targetType}:${f.id}`} className="flex items-center gap-1">
                        <FavoriteLink favorite={f} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate text-sm">{title}</span>
                          {f.targetType !== "project" && (
                            <span className="shrink-0 text-xs text-muted-foreground">{f.projectName}</span>
                          )}
                          <Badge variant="secondary" className={`ml-auto shrink-0 text-xs ${badge.className}`}>
                            {badge.label}
                          </Badge>
                        </FavoriteLink>
                        <FavoriteToggle
                          favorited
                          pending={toggleFavorite.isPending && toggleFavorite.variables?.id === f.id}
                          onToggle={() => toggleFavorite.mutate({ targetType: f.targetType, id: f.id, favorite: false })}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardList className="size-4 text-muted-foreground" aria-hidden="true" />
              {t("overview:myIssues.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {myIssues.length === 0
              ? <p className="text-sm text-muted-foreground">{t("overview:myIssues.empty")}</p>
              : (
                  <ul className="flex flex-col">
                    {myIssues.map(issue => (
                      <li key={issue.id}>
                        <Link
                          to="/projects/$projectId/issues/$issueId"
                          params={{ projectId: issue.projectId, issueId: issue.id }}
                          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                        >
                          <span className="truncate text-sm">{issue.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{issue.projectName}</span>
                          <Badge variant="secondary" className={`ml-auto shrink-0 text-xs ${ISSUE_STATUS_BADGE[issue.status]}`}>
                            {t(`projects:issues.status.${issue.status}` as const)}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShoppingCart className="size-4 text-muted-foreground" aria-hidden="true" />
              {t("overview:openProcurements.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openProcurements.length === 0
              ? <p className="text-sm text-muted-foreground">{t("overview:openProcurements.empty")}</p>
              : (
                  <ul className="flex flex-col">
                    {openProcurements.map(proc => (
                      <li key={proc.id}>
                        <Link
                          to="/projects/$projectId/procurements/$procurementId"
                          params={{ projectId: proc.projectId, procurementId: proc.id }}
                          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                        >
                          <span className="truncate text-sm">{proc.itemName}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{proc.projectName}</span>
                          {proc.amount !== null && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatMoney(proc.amount)}
                              {proc.currency ? ` ${proc.currency}` : ""}
                            </span>
                          )}
                          <Badge variant="secondary" className={`ml-auto shrink-0 text-xs ${PROCUREMENT_STATUS_BADGE[proc.status]}`}>
                            {t(`projects:procurement.status.${proc.status}` as const)}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Route the favorite row to its target (project page or item drawer). */
function FavoriteLink({ favorite, className, children }: {
  readonly favorite: FavoriteItem;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  if (favorite.targetType === "project") {
    return <Link to="/projects/$projectId" params={{ projectId: favorite.id }} className={className}>{children}</Link>;
  }
  if (favorite.targetType === "issue") {
    return (
      <Link
        to="/projects/$projectId/issues/$issueId"
        params={{ projectId: favorite.projectId, issueId: favorite.id }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link
      to="/projects/$projectId/procurements/$procurementId"
      params={{ projectId: favorite.projectId, procurementId: favorite.id }}
      className={className}
    >
      {children}
    </Link>
  );
}
