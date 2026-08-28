// Maritime identity rows for a project card in the projects list.
//
// The card is SECTION-AWARE, not type-aware: there is no `type` column on a
// project, so the list branches on the mounted section set. A project that
// mounts `ship-profile` gets this block; every other project keeps the plain
// description + tags body. The particulars RIDE ON THE LIST ROW itself
// (`sectionSummary["ship-profile"]`, FIX-071), so a page of ship cards costs
// one request — this component issues none of its own.

import type { ShipProfileSummary } from "@/shared/lib/api/projects";
import { useTranslation } from "react-i18next";
import { ShipStatusBadge } from "./-ship-status-badge";

interface ProjectShipIdentityProps {
  readonly profile: ShipProfileSummary | undefined;
}

export function ProjectShipIdentity({ profile }: ProjectShipIdentityProps) {
  const { t } = useTranslation("ships");

  // Render nothing at all when the row carries no summary: a half-filled
  // identity block reads as "this ship has no IMO" rather than "not loaded".
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
