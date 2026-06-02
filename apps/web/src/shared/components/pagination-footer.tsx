// Shared prev/next pagination footer for list surfaces (projects, ships,
// contacts, procurements). The left-side total label differs per list, so the
// caller passes it as `totalLabel`; the prev/next buttons use common i18n keys.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";

interface PaginationFooterProps {
  readonly page: number;
  readonly totalPages: number;
  /** Pre-rendered left label; the caller translates its own total-count string. */
  readonly totalLabel: ReactNode;
  readonly onPrev: () => void;
  readonly onNext: () => void;
}

export function PaginationFooter({ page, totalPages, totalLabel, onPrev, onNext }: PaginationFooterProps) {
  const { t } = useTranslation("common");
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{totalLabel}</span>
      <div className="flex gap-1">
        <Button variant="outline" disabled={page <= 1} onClick={onPrev}>{t("common.prev")}</Button>
        <Button variant="outline" disabled={page >= totalPages} onClick={onNext}>{t("common.next")}</Button>
      </div>
    </div>
  );
}
