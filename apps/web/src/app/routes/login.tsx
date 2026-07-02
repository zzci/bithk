/* eslint-disable react-refresh/only-export-components */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/shared/components/logo";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useBranding } from "@/shared/hooks/use-branding";
// Justified http-layer import (UI-028): the login page runs BEFORE a session
// exists, so its one-shot auth-mode probe and local-login POST stay on the
// raw client instead of the session-scoped api layer; BASE_PATH builds the
// OAuth redirect URL.
import { BASE_PATH, http, HttpError } from "@/shared/lib/http";
import { useAuthStore } from "@/shared/stores/auth";

interface LoginSearchParams {
  redirect: string | undefined;
}

interface AuthMode {
  mode: "single-user" | "oauth";
  oauthConfigured: boolean;
}

type LoginSessionState
  = | { readonly status: "checking" }
    | { readonly status: "anonymous" }
    | { readonly status: "authenticated"; readonly redirect: string };

export const Route = createFileRoute("/login")({
  staticData: { titleKey: "login:title" },
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): LoginSearchParams => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
});

function isSafeRedirect(url: string | undefined): string {
  if (!url)
    return `${BASE_PATH}/overview`;
  if (!url.startsWith("/") || url.startsWith("//"))
    return `${BASE_PATH}/overview`;
  return url;
}

function toRouterPath(url: string): string {
  if (!BASE_PATH)
    return url;
  if (url === BASE_PATH)
    return "/";
  if (url.startsWith(`${BASE_PATH}/`))
    return url.slice(BASE_PATH.length);
  return url;
}

export function LoginPage() {
  const { t } = useTranslation(["common", "login"]);
  const { redirect } = Route.useSearch();
  const target = isSafeRedirect(redirect);
  const fetchUser = useAuthStore(s => s.fetchUser);
  const { appDisplayName } = useBranding();

  const [mode, setMode] = useState<AuthMode | null>(null);
  const [sessionState, setSessionState] = useState<LoginSessionState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    void fetchUser().then((result) => {
      if (cancelled)
        return;
      if (result.kind === "ok") {
        setSessionState({ status: "authenticated", redirect: toRouterPath(target) });
        return;
      }
      setSessionState({ status: "anonymous" });
    });
    return () => {
      cancelled = true;
    };
  }, [fetchUser, target]);

  useEffect(() => {
    if (sessionState.status !== "anonymous")
      return;
    void http<{ success: boolean; data: AuthMode }>("/account/auth/mode")
      .then(res => setMode(res.data))
      .catch(() => setMode({ mode: "oauth", oauthConfigured: false }));
  }, [sessionState.status]);

  if (sessionState.status === "authenticated") {
    return <Navigate to={sessionState.redirect as never} replace />;
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-4">
      <div className="mx-auto w-full max-w-xs text-center">
        <Logo className="mx-auto size-10 mb-3" />
        <h1 className="text-2xl font-bold tracking-tight">
          {appDisplayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("login:description")}
        </p>

        {mode === null
          ? null
          : mode.mode === "single-user"
            ? <SingleUserForm redirectTarget={target} />
            : <OAuthButton redirectTarget={target} />}
      </div>
    </div>
  );
}

function OAuthButton({ redirectTarget }: { redirectTarget: string }) {
  const { t } = useTranslation(["common", "login"]);
  const loginUrl = `${BASE_PATH}/api/account/auth/login?redirect=${encodeURIComponent(redirectTarget)}`;
  return (
    <a href={loginUrl} className="mt-6 block">
      <Button className="w-full">
        <LogIn className="mr-2 size-4" />
        {t("login:button")}
      </Button>
    </a>
  );
}

function SingleUserForm({ redirectTarget }: { redirectTarget: string }) {
  const { t } = useTranslation(["common", "login"]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting)
      return;
    setSubmitting(true);
    setError(null);
    try {
      await http("/account/auth/login-local", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      window.location.href = redirectTarget;
    }
    catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        setError(t("login:rateLimited"));
      }
      else {
        setError(t("login:invalidCredentials"));
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3 text-left">
      <div className="space-y-1.5">
        <Label htmlFor="login-username">{t("login:username")}</Label>
        <Input
          id="login-username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={e => setUsername(e.currentTarget.value)}
          disabled={submitting}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-password">{t("login:password")}</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.currentTarget.value)}
          disabled={submitting}
        />
      </div>
      {error
        ? <p className="text-sm text-destructive">{error}</p>
        : null}
      <Button type="submit" className="w-full" disabled={submitting}>
        <LogIn className="mr-2 size-4" />
        {t("login:button")}
      </Button>
    </form>
  );
}
