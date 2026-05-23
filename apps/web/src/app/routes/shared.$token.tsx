/* eslint-disable react-refresh/only-export-components */
// Single public, unauthenticated landing page for any share token
// (`/shared/:token`, the URL `buildShareUrl` produces). Fetches the share
// meta, gates terminal states (not found / expired / exhausted), then delegates
// to the registry's per-resource public preview (document → markdown viewer +
// subtree nav + attachments; drive → file download / folder browser).

import { createFileRoute } from "@tanstack/react-router";
import { Loader2, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ShareShell, ShareStatus } from "@/shared/components/share/previews/shell";
import { usePublicShareMeta } from "@/shared/lib/api/share";
import { getShareResource } from "@/shared/lib/share/registry";
// Side-effect import: ensures resources are registered even when this public
// route is the first thing loaded (it renders outside the authed app shell).
import "@/shared/components/share/register";

export const Route = createFileRoute("/shared/$token")({
  component: PublicSharePage,
});

function PublicSharePage() {
  const { token } = Route.useParams();
  const { t } = useTranslation("share");
  const query = usePublicShareMeta(token);

  if (query.isLoading) {
    return (
      <ShareShell>
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          {t("common:common.loading")}
        </div>
      </ShareShell>
    );
  }

  const meta = query.data;
  if (query.error || !meta)
    return <ShareShell><ShareStatus icon={<ShieldAlert className="size-8 text-destructive" />} title={t("public.notFound")} /></ShareShell>;
  if (meta.expired)
    return <ShareShell><ShareStatus icon={<ShieldAlert className="size-8 text-amber-500" />} title={t("public.expired")} /></ShareShell>;
  if (meta.exhausted)
    return <ShareShell><ShareStatus icon={<ShieldAlert className="size-8 text-amber-500" />} title={t("public.exhausted")} /></ShareShell>;

  const definition = getShareResource(meta.resourceType);
  if (!definition)
    return <ShareShell><ShareStatus icon={<ShieldAlert className="size-8 text-destructive" />} title={t("public.notFound")} /></ShareShell>;

  return <>{definition.renderPublicPreview(meta, token)}</>;
}
