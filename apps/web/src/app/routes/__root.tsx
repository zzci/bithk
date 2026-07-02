/* eslint-disable react-refresh/only-export-components */
import type { ErrorComponentProps } from "@tanstack/react-router";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FullPageLoader } from "@/shared/components/full-page-loader";
import { NotFoundPage } from "@/shared/components/not-found";
import { Button } from "@/shared/components/ui/button";
import { useDocumentTitle } from "@/shared/hooks/use-page-title";
// Justified http-layer import (UI-028): no http() calls here — the root layout
// subscribes to global http events (session expiry) and uses BASE_PATH for the
// re-login redirect.
import { BASE_PATH, onHttpEvent } from "@/shared/lib/http";
import { useSystemStore } from "@/shared/stores/system";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootErrorComponent,
  notFoundComponent: NotFoundPage,
});

// Root-level router error boundary. TanStack Router renders this in place of a
// route subtree whose render/loader throws, so an uncaught error degrades to a
// friendly, reloadable panel instead of a white screen (the standalone
// `/error` route is only reached by explicit navigation). Mirrors the
// `status === "db-error"` panel pattern below; `providers.tsx` adds an outer
// React error boundary as the catch-all above the router.
function RootErrorComponent({ error }: ErrorComponentProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="mx-auto max-w-md text-center space-y-4 p-6">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-destructive/10">
          <span className="text-2xl">⚠</span>
        </div>
        <h1 className="text-xl font-bold text-destructive">{t("common.error.systemUnavailable")}</h1>
        {error.message && (
          <details className="text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              {t("common.errorDetails")}
            </summary>
            <pre className="mt-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground whitespace-pre-wrap break-words">{error.message}</pre>
          </details>
        )}
        <Button
          variant="default"
          className="px-4 py-2"
          onClick={() => window.location.reload()}
        >
          {t("common.retry")}
        </Button>
      </div>
    </div>
  );
}

const BYPASS_SUFFIXES = ["/denied", "/login", "/totp-verify", "/error"];

function redirectToLogin() {
  // Carry the query string too so deep-link context (filters, ids,
  // tabs) survives the session-expiry bounce — matches the redirect
  // value `_app.tsx` builds for its own guard.
  const current = window.location.pathname + window.location.search;
  if (BYPASS_SUFFIXES.some(s => current.startsWith(`${BASE_PATH}${s}`)))
    return;
  window.location.href = `${BASE_PATH}/login?redirect=${encodeURIComponent(current)}`;
}

function RootLayout() {
  const { t } = useTranslation();
  useDocumentTitle();

  const { status, dbError, fetchStatus, startPolling, stopPolling } = useSystemStore();

  useEffect(() => {
    void fetchStatus();
    startPolling();
    return stopPolling;
  }, [fetchStatus, startPolling, stopPolling]);

  useEffect(() => {
    return onHttpEvent((type) => {
      if (type === "unauthorized") {
        redirectToLogin();
      }
    });
  }, []);

  if (status === "loading") {
    return <FullPageLoader onRetry={() => void fetchStatus()} />;
  }

  if (status === "db-error") {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div className="mx-auto max-w-md text-center space-y-4 p-6">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-destructive/10">
            <span className="text-2xl">⚠</span>
          </div>
          <h1 className="text-xl font-bold text-destructive">{t("common.error.dbError")}</h1>
          <p className="text-sm text-muted-foreground">{t("common.error.dbErrorBody")}</p>
          {dbError && (
            <details className="text-left">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                {t("common.errorDetails")}
              </summary>
              <pre className="mt-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground whitespace-pre-wrap break-words">{dbError}</pre>
            </details>
          )}
          <Button
            variant="default"
            className="px-4 py-2"
            onClick={() => void fetchStatus()}
          >
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <p className="text-destructive">{t("common.error.systemUnavailable")}</p>
          <Button
            variant="default"
            className="px-4 py-2"
            onClick={() => void fetchStatus()}
          >
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Outlet />
    </div>
  );
}
