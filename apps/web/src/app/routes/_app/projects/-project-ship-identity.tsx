// Maritime identity rows for a project card in the projects list.
//
// The card is SECTION-AWARE, not type-aware: there is no `type` column on a
// project, so the list branches on the mounted section set. A project that
// mounts `ship-profile` gets this block; every other project keeps the plain
// description + tags body. The particulars are not on the list row, so they
// come from the section's own client, one query per ship card (TanStack Query
// dedupes it with the detail page's copy).

import { useTranslation } from "react-i18next";
import { useShipProfile } from "@/shared/lib/api/project-sections";
import { ShipStatusBadge } from "./-ship-status-badge";

interface ProjectShipIdentityProps {
  readonly projectId: string;
}

export function ProjectShipIdentity({ projectId }: ProjectShipIdentityProps) {
  const { t } = useTranslation("ships");
  const profileQuery = useShipProfile(projectId);
  const profile = profileQuery.data;

  // Render nothing at all until the profile resolves: a half-filled identity
  // block reads as "this ship has no IMO" rather than "still loading".
  if (!profile)
    return null;

  const notSet = t("overview.notSet");

  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
      <IdentityRow label={t("field.hullNumber")} value={profile.hullNumber} />
      <IdentityRow label={t("field.imoNumber")} value={profile.imoNumber ?? notSet} />
      <IdentityRow label={t("field.mmsi")} value={profile.mmsi ?? notSet} />
      <div className="flex min-w-0 items-center justify-end">
        <ShipStatusBadge status={profile.shipStatus} />
      </div>
    </dl>
  );
}

function IdentityRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-xs">{value}</dd>
    </div>
  );
}
