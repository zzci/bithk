/* eslint-disable react-refresh/only-export-components */
import type { LucideIcon } from "lucide-react";
import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { FileText, FolderKanban } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/shared/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { useAuthStore } from "@/shared/stores/auth";

export const Route = createLazyFileRoute("/_app/overview")({
  component: OverviewPage,
});

// Single source of truth for overview landing tiles. Add a new tile here and
// it will appear on the overview home automatically; descriptions resolve to
// `overview.tile.<key>Description` and titles to `nav.<key>` in i18n.
interface OverviewTile {
  readonly key: string;
  readonly path: string;
  readonly icon: LucideIcon;
}

const OVERVIEW_TILES: readonly OverviewTile[] = [
  { key: "projects", path: "/projects", icon: FolderKanban },
  { key: "documents", path: "/documents", icon: FileText },
];

function OverviewPage() {
  const { t } = useTranslation(["common", "overview"]);
  const user = useAuthStore(s => s.user);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("overview:welcome", { name: user?.name ?? user?.username ?? "" })}
        description={t("overview:page.description")}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {OVERVIEW_TILES.map(tile => (
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
    </div>
  );
}
