import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";

const STILL_LOADING_DELAY = 10_000;

interface FullPageLoaderProps {
  readonly onRetry?: () => void;
}

export function FullPageLoader({ onRetry }: FullPageLoaderProps) {
  const { t } = useTranslation();
  const [stillLoading, setStillLoading] = useState(false);

  useEffect(() => {
    const handle = setTimeout(setStillLoading, STILL_LOADING_DELAY, true);
    return () => clearTimeout(handle);
  }, []);

  const handleRetry = () => {
    if (onRetry)
      onRetry();
    else
      window.location.reload();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background"
    >
      <Spinner size="lg" className="text-muted-foreground" />
      <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
      {stillLoading && (
        <div className="mt-2 flex flex-col items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("common.stillLoading")}
          </span>
          <Button variant="outline" onClick={handleRetry}>
            {t("common.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
