// Shared chrome for the public share landing page: the centered card shell,
// a status panel for terminal states, the icon header + password prompt the
// document/drive previews share, and the byte formatter the previews use.

import type { FormEvent, ReactNode } from "react";

import { Loader2, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Logo } from "@/shared/components/logo";
import { ModeToggle } from "@/shared/components/mode-toggle";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

export function ShareShell({ children, wide }: { readonly children: ReactNode; readonly wide?: boolean }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="flex items-center justify-between px-4 py-3 md:px-6">
        <Logo />
        <ModeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center p-4">
        <div className={`w-full ${wide ? "max-w-5xl" : "max-w-md"} rounded-xl border bg-background p-6 shadow-sm`}>
          {children}
        </div>
      </main>
    </div>
  );
}

export function ShareStatus({ icon, title }: { readonly icon: ReactNode; readonly title: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      {icon}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
    </div>
  );
}

/** Tinted icon tile + truncated name, optionally with a subtitle line below. */
export function ShareIconHeader({
  icon,
  name,
  subtitle,
}: {
  readonly icon: ReactNode;
  readonly name: string;
  readonly subtitle?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      {subtitle === undefined
        ? <p className="min-w-0 truncate text-base font-medium">{name}</p>
        : (
            <div className="min-w-0">
              <p className="truncate text-base font-medium">{name}</p>
              {subtitle}
            </div>
          )}
    </div>
  );
}

/** Password label + masked input used by the share unlock prompts. */
export function PasswordField({ value, onChange }: { readonly value: string; readonly onChange: (v: string) => void }) {
  const { t } = useTranslation("share");
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      <span className="flex items-center gap-1.5">
        <Lock className="size-3.5" />
        {t("public.password")}
      </span>
      <Input
        type="password"
        value={value}
        onChange={e => onChange(e.currentTarget.value)}
        placeholder={t("public.passwordPlaceholder")}
        autoComplete="off"
      />
    </label>
  );
}

/** Password-gated share unlock form: icon header + password field + submit. */
export function PasswordPrompt({
  icon,
  name,
  value,
  onChange,
  error,
  loading,
  onSubmit,
}: {
  readonly icon: ReactNode;
  readonly name: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly error: string | null;
  readonly loading?: boolean;
  readonly onSubmit: () => void;
}) {
  const { t } = useTranslation("share");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <ShareIconHeader icon={icon} name={name} />
      <PasswordField value={value} onChange={onChange} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={Boolean(loading) || !value}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
        {t("public.open")}
      </Button>
    </form>
  );
}
