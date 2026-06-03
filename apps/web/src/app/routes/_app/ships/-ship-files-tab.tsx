// Files tab: a ship's files ARE its base project's files (PLAN-011 §6, drive
// unchanged). We reuse the shared project FileBrowser pointed at the base
// project — never a forked or ship-specific drive surface.

import type { ShipView } from "@/shared/lib/api/ships";
import { useTranslation } from "react-i18next";
import { useProject } from "@/shared/lib/api/projects";
import { FileBrowser } from "../-file-browser";
import { useProjectCapabilities } from "../projects/-use-project-role";

interface ShipFilesTabProps {
  readonly ship: ShipView;
}

export function ShipFilesTab({ ship }: ShipFilesTabProps) {
  const { t } = useTranslation("ships");

  // Drive write/delete is gated on the SAME unified predicate as the rest of
  // the ship detail: app-admin OR `project.manage` on the base project. Caps
  // are anchored on the base project's detail payload; viewers get read-only.
  const baseProjectQuery = useProject(ship.baseProjectId ?? undefined);
  const caps = useProjectCapabilities(baseProjectQuery.data);

  if (!ship.baseProjectId)
    return <p className="text-sm text-muted-foreground">{t("files.noBaseProject")}</p>;

  return (
    // Match the project files tab: bare wrapper, -mx-4 cancels the drive
    // surface's px-4 gutter, height tracks viewport like the project pattern.
    <div className="-mx-4 h-[calc(100svh-18rem)] min-h-[24rem]">
      <FileBrowser
        ownerType="project"
        ownerId={ship.baseProjectId}
        canManage={caps.canManageProject}
        rootLabel={ship.name}
        features={{ breadcrumb: false, search: false }}
      />
    </div>
  );
}
