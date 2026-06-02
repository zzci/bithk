import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Component, useEffect } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShareDialogHost } from "@/shared/components/share";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { Button } from "@/shared/components/ui/button";
import { HttpError } from "@/shared/lib/http";
import { queryClient } from "@/shared/lib/query-client";
import i18n from "./i18n";
// Side-effect import: registers the shareable resources (drive + document)
// into the frontend share registry before the share dialog host mounts.
import "@/shared/components/share/register";

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

// App-wide React error boundary — the last-resort safety net. An uncaught
// render error anywhere in the tree (including the router shell, above any
// route-level boundary) otherwise leaves a blank white screen; here it shows a
// friendly, reloadable fallback instead. Mirrors the `db-error` panel pattern
// in `__root.tsx`.
class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error)
      return <AppErrorFallback error={this.state.error} />;
    return this.props.children;
  }
}

function AppErrorFallback({ error }: { readonly error: Error }) {
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

// Global query-error surface. The shared QueryClient (see `query-client.ts`)
// has no QueryCache `onError`, so a failed query resolves to `undefined` data
// and silently degrades to an empty state. Subscribe to the cache and raise a
// toast on hard failures (5xx / network). Client errors (401/403/404/422) are
// intentionally skipped: a 401 already bounces to login and the rest surface
// inline at their call sites, so toasting them would just be noise.
function QueryErrorToaster() {
  const { t } = useTranslation();
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    return cache.subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error")
        return;
      const { error } = event.query.state;
      if (error instanceof HttpError && error.status >= 400 && error.status < 500)
        return;
      toast.error(t("common.error.loadFailed"));
    });
  }, [t]);
  return null;
}

export function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AppErrorBoundary>{children}</AppErrorBoundary>
          <QueryErrorToaster />
          {/* One app-level share dialog every caller drives via useShare(). */}
          <ShareDialogHost />
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
