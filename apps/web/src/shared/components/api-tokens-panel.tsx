import type { ApiTokenView, CreatedApiToken, ScopeLevel, TokenScopeMap, TokenTarget } from "@/shared/lib/api/tokens";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Separator } from "@/shared/components/ui/separator";
import { Spinner } from "@/shared/components/ui/spinner";
import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import { createToken, listTokens, revokeToken, TOKEN_EXPIRY_OPTIONS, TOKEN_SCOPE_MODULES } from "@/shared/lib/api/tokens";
import { formatDate } from "@/shared/lib/format";

type Level = ScopeLevel | "none";

function tokenKey(target: TokenTarget) {
  return ["api-tokens", target.kind, target.kind === "user" ? target.userId : "self"] as const;
}

export function ApiTokensPanel({ target }: { readonly target: TokenTarget }) {
  const { t } = useTranslation(["common", "tokens"]);
  const queryClient = useQueryClient();
  const [view, setView] = useState<"list" | "create">("list");
  const [created, setCreated] = useState<CreatedApiToken | null>(null);

  const tokensQuery = useQuery({
    queryKey: tokenKey(target),
    queryFn: () => listTokens(target),
  });
  const tokens = tokensQuery.data ?? [];

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeToken(target, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokenKey(target) }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: tokenKey(target) });

  const handleRevealDone = () => {
    setCreated(null);
    void invalidate();
  };

  const handleCreated = (tok: CreatedApiToken) => {
    setView("list");
    setCreated(tok);
  };

  if (created) {
    return <RevealStep token={created} onDone={handleRevealDone} />;
  }

  if (view === "create") {
    return (
      <CreateStep
        target={target}
        onCancel={() => setView("list")}
        onCreated={handleCreated}
      />
    );
  }

  return (
    <div className="space-y-3 pt-4">
      <p className="text-xs text-muted-foreground">
        {target.kind === "self" ? t("tokens:subtitle") : t("tokens:subtitleAdmin")}
      </p>

      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("tokens:title")}
        </div>
        <Button variant="outline" onClick={() => setView("create")}>
          <Plus className="mr-1 size-3.5" />
          {t("tokens:create")}
        </Button>
      </div>

      {tokensQuery.isPending
        ? <p className="py-6 text-center text-sm text-muted-foreground">{t("tokens:loading")}</p>
        : tokens.length === 0
          ? <p className="py-6 text-center text-sm text-muted-foreground">{t("tokens:empty")}</p>
          : (
              <div className="space-y-2">
                {tokens.map(tok => (
                  <TokenRow
                    key={tok.id}
                    token={tok}
                    onRevoke={() => revokeMutation.mutate(tok.id)}
                    revoking={revokeMutation.isPending}
                  />
                ))}
              </div>
            )}
    </div>
  );
}

function TokenRow({ token, onRevoke, revoking }: {
  readonly token: ApiTokenView;
  readonly onRevoke: () => void;
  readonly revoking: boolean;
}) {
  const { t } = useTranslation(["common", "tokens"]);
  const [confirming, setConfirming] = useState(false);
  const scopeCount = Object.keys(token.scopes).length;
  const inactive = token.revokedAt != null || token.expired;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{token.name}</span>
            {token.revokedAt != null && <Badge variant="destructive" className="text-2xs px-1 py-0">{t("tokens:revoked")}</Badge>}
            {token.revokedAt == null && token.expired && <Badge variant="secondary" className="text-2xs px-1 py-0">{t("tokens:expired")}</Badge>}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {token.prefix}
            …
          </div>
          <div className="text-2xs text-muted-foreground">
            {scopeCount > 0 ? t("tokens:scopeSummary", { count: scopeCount }) : t("tokens:scopeSummaryNone")}
            {" · "}
            {t("tokens:expiresAt", { date: formatDate(token.expiresAt) })}
            {" · "}
            {token.lastUsedAt ? t("tokens:lastUsed", { date: formatDate(token.lastUsedAt) }) : t("tokens:lastUsedNever")}
          </div>
        </div>
      </div>
      {!inactive && (
        confirming
          ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="destructive" size="sm" className="h-6 px-2 text-xs" onClick={onRevoke} disabled={revoking}>
                  {t("tokens:revoke")}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setConfirming(false)}>
                  {t("tokens:cancel")}
                </Button>
              </div>
            )
          : (
              <Button variant="ghost" size="icon-xs" className="shrink-0" onClick={() => setConfirming(true)} title={t("tokens:revoke")}>
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            )
      )}
    </div>
  );
}

function CreateStep({ target, onCancel, onCreated }: {
  readonly target: TokenTarget;
  readonly onCancel: () => void;
  readonly onCreated: (token: CreatedApiToken) => void;
}) {
  const { t } = useTranslation(["common", "tokens"]);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number>(30);
  const [levels, setLevels] = useState<Record<string, Level>>({});
  const [error, setError] = useState<string | null>(null);

  const scopes = useMemo<TokenScopeMap>(() => {
    const map: TokenScopeMap = {};
    for (const [mod, level] of Object.entries(levels)) {
      if (level === "read" || level === "write")
        map[mod as keyof TokenScopeMap] = level;
    }
    return map;
  }, [levels]);

  const createMutation = useMutation({
    mutationFn: () => createToken(target, { name: name.trim(), expiresInDays, scopes }),
    onSuccess: onCreated,
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t("tokens:errors.createFailed")),
  });

  const submit = () => {
    if (!name.trim()) {
      setError(t("tokens:errors.nameRequired"));
      return;
    }
    setError(null);
    createMutation.mutate();
  };

  return (
    <div className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="token-name">{t("tokens:name")}</Label>
        <Input id="token-name" value={name} onChange={e => setName(e.target.value)} placeholder={t("tokens:namePlaceholder")} autoFocus />
      </div>

      <div className="space-y-2">
        <Label htmlFor="token-expiry">{t("tokens:expiry")}</Label>
        <Select value={String(expiresInDays)} onValueChange={v => v && setExpiresInDays(Number(v))}>
          <SelectTrigger id="token-expiry" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TOKEN_EXPIRY_OPTIONS.map(days => (
              <SelectItem key={days} value={String(days)}>{t(`tokens:expiryOption.${days}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>{t("tokens:scopes")}</Label>
        <p className="text-xs text-muted-foreground">{t("tokens:scopesHint")}</p>
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border p-2">
          {TOKEN_SCOPE_MODULES.map(mod => (
            <div key={mod} className="flex items-center justify-between gap-2">
              <span className="truncate text-sm">{t(`tokens:modules.${mod}`)}</span>
              <Select
                value={levels[mod] ?? "none"}
                onValueChange={v => v && setLevels(prev => ({ ...prev, [mod]: v as Level }))}
              >
                <SelectTrigger size="sm" className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("tokens:level.none")}</SelectItem>
                  <SelectItem value="read">{t("tokens:level.read")}</SelectItem>
                  <SelectItem value="write">{t("tokens:level.write")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>{t("tokens:cancel")}</Button>
        <Button onClick={submit} disabled={createMutation.isPending} aria-busy={createMutation.isPending} className="min-w-[96px]">
          {createMutation.isPending
            ? (
                <>
                  <Spinner />
                  {t("tokens:creating")}
                </>
              )
            : t("tokens:submit")}
        </Button>
      </div>
    </div>
  );
}

function RevealStep({ token, onDone }: { readonly token: CreatedApiToken; readonly onDone: () => void }) {
  const { t } = useTranslation(["common", "tokens"]);
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
        <div className="flex items-start gap-2 text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("tokens:reveal.title")}</p>
            <p className="text-xs">{t("tokens:reveal.warning")}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 select-all break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">{token.token}</code>
        <Button variant="ghost" size="icon-xs" onClick={() => copy(token.token)} title={t("tokens:reveal.copy")}>
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </Button>
      </div>

      <div className="flex justify-end">
        <Button onClick={onDone}>{t("tokens:reveal.done")}</Button>
      </div>
    </div>
  );
}
