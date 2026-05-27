// Cover image control for a ship (Overview tab, gated on canManage). Upload /
// replace / remove a ship cover. Mirrors the project cover field.

import type { ShipView } from "@/shared/lib/api/ships";
import { Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { CoverImage } from "@/shared/components/cover-image";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Label } from "@/shared/components/ui/label";
import { useRemoveShipCover, useSetShipCover } from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";

export function ShipCoverField({ ship }: { readonly ship: ShipView }) {
  const { t } = useTranslation(["ships", "common"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const setCover = useSetShipCover();
  const removeCover = useRemoveShipCover();
  const pending = setCover.isPending || removeCover.isPending;
  const error = setCover.error ?? removeCover.error;

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file)
      setCover.mutate({ id: ship.id, file });
    event.target.value = "";
  };

  return (
    <div className="space-y-2">
      <Label>{t("cover.label")}</Label>
      {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}
      <div className="flex items-center gap-4">
        <CoverImage src={ship.coverImageUrl} kind="ship" className="h-24 w-40 shrink-0 rounded-lg border" />
        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden="true" />
            {ship.coverImageUrl ? t("cover.replace") : t("cover.upload")}
          </Button>
          {ship.coverImageUrl && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => removeCover.mutate(ship.id)}>
              <Trash2 className="text-destructive" aria-hidden="true" />
              {t("cover.remove")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
