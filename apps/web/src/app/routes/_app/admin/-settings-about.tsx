import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { EmptyHint } from "@/shared/components/ui/centered-hint";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { http } from "@/shared/lib/http";

interface VersionResponse {
  readonly data: SystemVersion;
}

interface SystemVersion {
  readonly version: string | null;
  readonly commit: string | null;
  readonly buildTime: string | null;
  readonly lode?: LodeStatus | null;
}

interface LodeStatus {
  readonly configured?: boolean | null;
  readonly active?: boolean | null;
  readonly status?: string | null;
  readonly current?: string | null;
  readonly available?: string | null;
  readonly lastCheckAt?: string | null;
  readonly lastError?: string | null;
  readonly stateStatus?: string | null;
  readonly readiness?: {
    readonly ready?: boolean | null;
  } | null;
  readonly update?: {
    readonly configStatus?: string | null;
    readonly policy?: string | null;
    readonly channel?: string | null;
    readonly asset?: string | null;
    readonly sourceType?: string | null;
    readonly source?: string | null;
  } | null;
}

const versionQueryKey = ["system", "version"] as const;

export function AboutSettingsTab() {
  const { t } = useTranslation(["settings", "common"]);
  const versionQuery = useQuery({
    queryKey: versionQueryKey,
    queryFn: async () => (await http<VersionResponse>("/system/version")).data,
  });

  const version = versionQuery.data;

  return (
    <div className="space-y-4 pt-4">
      {versionQuery.error && (
        <ErrorBanner message={versionQuery.error instanceof Error ? versionQuery.error.message : t("common:common.error.loadFailed")} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("settings:about.title")}</CardTitle>
          <CardDescription>{t("settings:about.description")}</CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void versionQuery.refetch()}
              disabled={versionQuery.isFetching}
            >
              <RefreshCw className={versionQuery.isFetching ? "animate-spin" : undefined} />
              {t("settings:about.refresh")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {versionQuery.isLoading
            ? <EmptyHint>{t("common:common.loading")}</EmptyHint>
            : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <InfoField label={t("settings:about.version")} value={version?.version} />
                  <InfoField label={t("settings:about.commit")} value={version?.commit} mono />
                  <InfoField label={t("settings:about.buildTime")} value={formatBuildTime(version?.buildTime)} />
                </div>
              )}
        </CardContent>
      </Card>

      <LodeStatusCard lode={version?.lode} />
    </div>
  );
}

function LodeStatusCard({ lode }: { readonly lode: LodeStatus | null | undefined }) {
  const { t } = useTranslation(["settings"]);
  const readinessReady = lode?.readiness?.ready;
  // An update is pending when lode has detected a version different from the
  // running one (compare to `current`, not just presence — they're equal once
  // the update has been applied).
  const updateAvailable = !!lode?.available && lode.available !== lode.current;
  const lifecycleRows = [
    { label: t("settings:about.lode.status"), value: safeText(lode?.status) },
    { label: t("settings:about.lode.current"), value: safeText(lode?.current) },
    { label: t("settings:about.lode.available"), value: safeText(lode?.available) },
    { label: t("settings:about.lode.stateStatus"), value: safeText(lode?.stateStatus) },
    { label: t("settings:about.lode.readiness"), value: readinessReady == null ? null : boolText(readinessReady, t) },
  ].filter(row => row.value !== null);
  const updateRows = [
    { label: t("settings:about.lode.configStatus"), value: safeText(lode?.update?.configStatus) },
    { label: t("settings:about.lode.policy"), value: safeText(lode?.update?.policy) },
    { label: t("settings:about.lode.channel"), value: safeText(lode?.update?.channel) },
    { label: t("settings:about.lode.asset"), value: safeText(lode?.update?.asset) },
    { label: t("settings:about.lode.sourceType"), value: safeText(lode?.update?.sourceType) },
    { label: t("settings:about.lode.source"), value: safeText(lode?.update?.source) },
    { label: t("settings:about.lode.lastCheck"), value: safeText(lode?.lastCheckAt) },
    { label: t("settings:about.lode.lastError"), value: safeText(lode?.lastError) },
  ].filter(row => row.value !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings:about.lode.title")}</CardTitle>
        <CardDescription>{t("settings:about.lode.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {lode
          ? (
              <>
                {updateAvailable && (
                  <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                    <ArrowUpCircle className="size-4 shrink-0 text-primary" />
                    <span>{t("settings:about.lode.updateAvailable", { version: lode.available, current: lode.current ?? "?" })}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <BooleanBadge label={t("settings:about.lode.configured")} value={lode.configured} />
                  <BooleanBadge label={t("settings:about.lode.active")} value={lode.active} />
                </div>

                <InfoSection title={t("settings:about.lode.lifecycle")} rows={lifecycleRows} />
                <InfoSection title={t("settings:about.lode.update")} rows={updateRows} />
              </>
            )
          : (
              <EmptyHint>{t("settings:about.lode.unavailable")}</EmptyHint>
            )}
      </CardContent>
    </Card>
  );
}

function InfoSection({ title, rows }: { readonly title: string; readonly rows: readonly { readonly label: string; readonly value: ReactNode }[] }) {
  const { t } = useTranslation("settings");
  return (
    <div className="rounded-lg border">
      <div className="border-b px-3 py-2 text-sm font-medium">{title}</div>
      {rows.length > 0
        ? (
            <div className="divide-y">
              {rows.map(row => (
                <div key={row.label} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[11rem_1fr]">
                  <div className="text-muted-foreground">{row.label}</div>
                  <div className="min-w-0 break-words">{row.value}</div>
                </div>
              ))}
            </div>
          )
        : <div className="px-3 py-2 text-sm text-muted-foreground">{t("about.empty")}</div>}
    </div>
  );
}

function InfoField({ label, value, mono = false }: { readonly label: string; readonly value: string | null | undefined; readonly mono?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={mono ? "mt-1 break-all font-mono text-sm" : "mt-1 break-words text-sm font-medium"}>
        {safeText(value) ?? "—"}
      </div>
    </div>
  );
}

function BooleanBadge({ label, value }: { readonly label: string; readonly value: boolean | null | undefined }) {
  const { t } = useTranslation("settings");
  const enabled = value === true;
  return (
    <Badge variant={enabled ? "secondary" : "outline"}>
      {enabled ? <CheckCircle2 /> : <XCircle />}
      <span>{`${label}:`}</span>
      <span>{boolText(value, t)}</span>
    </Badge>
  );
}

function boolText(value: boolean | null | undefined, t: (key: string) => string) {
  if (value === true)
    return t("about.yes");
  if (value === false)
    return t("about.no");
  return t("about.unknown");
}

function safeText(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function formatBuildTime(value: string | null | undefined) {
  const text = safeText(value);
  if (!text)
    return null;
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp))
    return text;
  return new Date(timestamp).toLocaleString();
}
