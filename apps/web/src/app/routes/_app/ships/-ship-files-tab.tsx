// Files tab: a ship's files ARE its base project's files (PLAN-011 §6, drive
// unchanged). We reuse the shared project FileBrowser pointed at the base
// project — never a forked or ship-specific drive surface.

import type { ShipView } from "@/shared/lib/api/ships";
import { useTranslation } from "react-i18next";
import { FileBrowser } from "../-file-browser";

interface ShipFilesTabProps {
  readonly ship: ShipView;
}

export function ShipFilesTab({ ship }: ShipFilesTabProps) {
  const { t } = useTranslation("ships");

  if (!ship.baseProjectId)
    return <p className="text-sm text-muted-foreground">{t("files.noBaseProject")}</p>;

  return (
    <div className="h-[calc(100svh-22rem)] min-h-[24rem] overflow-hidden rounded-xl border bg-card">
      <FileBrowser
        ownerType="project"
        ownerId={ship.baseProjectId}
        canManage
        rootLabel={ship.name}
        showTitle={false}
        showSearch={false}
      />
    </div>
  );
}
