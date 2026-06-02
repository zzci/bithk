// Cover image control for a ship (Overview tab, gated on canManage). Thin wrapper
// around the shared CoverField: owns the ship cover mutations. Unlike the project
// field, it shows no success/error toasts (error surfaces via the inline banner).

import type { ShipView } from "@/shared/lib/api/ships";
import { useTranslation } from "react-i18next";
import { CoverField } from "@/shared/components/cover-field";
import { useRemoveShipCover, useSetShipCover } from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";

export function ShipCoverField({ ship }: { readonly ship: ShipView }) {
  const { t } = useTranslation(["ships", "common"]);
  const setCover = useSetShipCover();
  const removeCover = useRemoveShipCover();
  const pending = setCover.isPending || removeCover.isPending;
  const error = setCover.error ?? removeCover.error;

  return (
    <CoverField
      kind="ship"
      src={ship.coverImageUrl}
      pending={pending}
      error={error ? errorMessage(error, t("common:common.error.operationFailed")) : null}
      onPick={file => setCover.mutate({ id: ship.id, file })}
      onRemove={() => removeCover.mutate(ship.id)}
      labels={{
        field: t("cover.label"),
        upload: t("cover.upload"),
        replace: t("cover.replace"),
        remove: t("cover.remove"),
      }}
    />
  );
}
