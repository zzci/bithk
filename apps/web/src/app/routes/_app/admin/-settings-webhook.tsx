import type { WebhookView } from "@/shared/lib/api/webhooks";
import { History, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { EmptyHint } from "@/shared/components/ui/centered-hint";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from "@/shared/lib/api/webhooks";
import { formatDateTime } from "@/shared/lib/format";

// Admin Settings › Webhooks (FEAT-060): subscriptions live in their own
// tables behind `/admin/webhooks`; this tab is the CRUD surface plus the
// test ping and the per-webhook delivery log.

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  success: "default",
  failed: "destructive",
  pending: "secondary",
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function splitEvents(raw: string): string[] {
  const list = raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  return list.length === 0 ? ["*"] : list;
}

type DialogState = { readonly mode: "create" } | { readonly mode: "edit"; readonly hook: WebhookView };

export function WebhookSettingsTab() {
  const { t } = useTranslation(["common", "settings"]);
  const query = useWebhooks();
  const update = useUpdateWebhook();
  const remove = useDeleteWebhook();
  const test = useTestWebhook();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleting, setDeleting] = useState<WebhookView | null>(null);
  const [logFor, setLogFor] = useState<WebhookView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const webhooks = query.data ?? [];
  const loadError = query.error ? errorMessage(query.error, t("common.error.loadFailed")) : null;

  const toggleEnabled = (hook: WebhookView, enabled: boolean) => {
    setError(null);
    update.mutate({ id: hook.id, patch: { enabled } }, {
      onError: err => setError(errorMessage(err, t("common.error.operationFailed"))),
    });
  };

  const sendTest = (hook: WebhookView) => {
    setError(null);
    test.mutate(hook.id, {
      onSuccess: () => toast.success(t("settings:webhook.testQueued", { name: hook.name })),
      onError: err => setError(errorMessage(err, t("common.error.operationFailed"))),
    });
  };

  const confirmDelete = () => {
    if (!deleting)
      return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success(t("settings:webhook.deleted"));
        setDeleting(null);
      },
      onError: (err) => {
        setError(errorMessage(err, t("common.error.deleteFailed")));
        setDeleting(null);
      },
    });
  };

  return (
    <div className="space-y-4 pt-4">
      {(error ?? loadError) && <ErrorBanner message={error ?? loadError ?? ""} />}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("settings:webhook.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings:webhook.description")}</p>
        </div>
        <Button onClick={() => setDialog({ mode: "create" })}>
          <Plus className="mr-1 size-3" />
          {t("settings:webhook.create")}
        </Button>
      </div>

      {query.isPending
        ? <EmptyHint>{t("common.loading")}</EmptyHint>
        : webhooks.length === 0
          ? <EmptyHint className="rounded-md border">{t("settings:webhook.noWebhooks")}</EmptyHint>
          : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("settings:webhook.colName")}</TableHead>
                      <TableHead>{t("settings:webhook.colEvents")}</TableHead>
                      <TableHead>{t("settings:webhook.colEnabled")}</TableHead>
                      <TableHead>{t("settings:webhook.colLastDelivery")}</TableHead>
                      <TableHead className="w-36">{t("settings:col.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhooks.map(hook => (
                      <TableRow key={hook.id}>
                        <TableCell>
                          <div className="font-medium">{hook.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{hook.url}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {hook.hasSecret ? t("settings:webhook.fieldSecret") : t("settings:webhook.noSecret")}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {hook.events.map(pattern => (
                              <Badge key={pattern} variant="outline">{pattern === "*" ? t("settings:webhook.allEvents") : pattern}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={hook.enabled}
                            aria-label={t("settings:webhook.colEnabled")}
                            onCheckedChange={checked => toggleEnabled(hook, checked)}
                          />
                        </TableCell>
                        <TableCell>
                          {hook.lastDeliveryStatus
                            ? (
                                <div className="space-y-1">
                                  <Badge variant={STATUS_VARIANT[hook.lastDeliveryStatus] ?? "outline"}>
                                    {t(`settings:webhook.status.${hook.lastDeliveryStatus}`)}
                                  </Badge>
                                  <div className="text-xs text-muted-foreground">{hook.lastDeliveryAt ? formatDateTime(hook.lastDeliveryAt) : ""}</div>
                                  {hook.consecutiveFailures > 0 && (
                                    <div className="text-xs text-destructive">{t("settings:webhook.failures", { count: hook.consecutiveFailures })}</div>
                                  )}
                                </div>
                              )
                            : <span className="text-sm text-muted-foreground">{t("settings:webhook.never")}</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" aria-label={t("settings:webhook.test")} disabled={test.isPending} onClick={() => sendTest(hook)}>
                              <Play className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={t("settings:webhook.deliveries")} onClick={() => setLogFor(hook)}>
                              <History className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={t("settings:webhook.edit")} onClick={() => setDialog({ mode: "edit", hook })}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={t("common.delete")} onClick={() => setDeleting(hook)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

      {dialog && (
        <WebhookFormDialog
          key={dialog.mode === "edit" ? dialog.hook.id : "create"}
          state={dialog}
          existingNames={webhooks.map(w => w.name)}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        title={t("settings:webhook.deleteTitle")}
        description={t("settings:webhook.deleteDescription", { name: deleting?.name ?? "" })}
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />

      <WebhookDeliveriesDialog hook={logFor} onClose={() => setLogFor(null)} />
    </div>
  );
}

// ─── Create / edit dialog ───

function WebhookFormDialog({
  state,
  existingNames,
  onClose,
}: {
  readonly state: DialogState;
  readonly existingNames: readonly string[];
  readonly onClose: () => void;
}) {
  const { t } = useTranslation(["common", "settings"]);
  const create = useCreateWebhook();
  const update = useUpdateWebhook();
  const existing = state.mode === "edit" ? state.hook : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState(existing ? existing.events.join(", ") : "*");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const nameTaken = existingNames.includes(name.trim()) && name.trim() !== existing?.name;
  const canSave = name.trim() !== "" && url.trim() !== "" && !nameTaken;
  const saving = create.isPending || update.isPending;

  const handleSave = async () => {
    if (!canSave)
      return;
    setError(null);
    try {
      if (existing) {
        await update.mutateAsync({
          id: existing.id,
          patch: { name: name.trim(), url: url.trim(), events: splitEvents(events), enabled, ...(secret.trim() ? { secret: secret.trim() } : {}) },
        });
      }
      else {
        await create.mutateAsync({
          name: name.trim(),
          url: url.trim(),
          ...(secret.trim() ? { secret: secret.trim() } : {}),
          events: splitEvents(events),
          enabled,
        });
      }
      toast.success(t("settings:webhook.saved"));
      onClose();
    }
    catch (err) {
      setError(errorMessage(err, t("common.error.operationFailed")));
    }
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? t("settings:webhook.editTitle") : t("settings:webhook.createTitle")}</DialogTitle>
          <DialogDescription>{existing ? t("settings:webhook.editDescription") : t("settings:webhook.createDescription")}</DialogDescription>
        </DialogHeader>
        {error && <ErrorBanner message={error} />}
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="wh-name">{t("settings:webhook.fieldName")}</Label>
            <Input id="wh-name" placeholder="my-webhook" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wh-url">{t("settings:webhook.fieldUrl")}</Label>
            <Input id="wh-url" placeholder="https://example.com/webhook" value={url} onChange={e => setUrl(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wh-secret">{t("settings:webhook.fieldSecret")}</Label>
            <Input id="wh-secret" type="password" placeholder={t("settings:webhook.secretPlaceholder")} value={secret} onChange={e => setSecret(e.target.value)} />
            {existing?.hasSecret && <p className="text-xs text-muted-foreground">{t("settings:webhook.secretKeepHint")}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="wh-events">{t("settings:webhook.fieldEvents")}</Label>
            <Textarea id="wh-events" placeholder={t("settings:webhook.allEventsPlaceholder")} value={events} onChange={e => setEvents(e.target.value)} rows={2} />
            <p className="text-xs text-muted-foreground">{t("settings:webhook.eventsHint")}</p>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="wh-enabled" checked={enabled} aria-label={t("settings:webhook.fieldEnabled")} onCheckedChange={setEnabled} />
            <Label htmlFor="wh-enabled">{t("settings:webhook.fieldEnabled")}</Label>
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">{t("common.cancel")}</Button>} />
          <Button disabled={!canSave || saving} onClick={() => void handleSave()}>
            {saving ? t("settings:saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Deliveries dialog ───

function WebhookDeliveriesDialog({ hook, onClose }: { readonly hook: WebhookView | null; readonly onClose: () => void }) {
  const { t } = useTranslation(["common", "settings"]);
  const deliveries = useWebhookDeliveries(hook?.id ?? null);
  const rows = deliveries.data ?? [];
  return (
    <Dialog open={hook !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("settings:webhook.deliveriesTitle", { name: hook?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("settings:webhook.deliveriesDescription")}</DialogDescription>
        </DialogHeader>
        {deliveries.isPending
          ? <EmptyHint>{t("common.loading")}</EmptyHint>
          : rows.length === 0
            ? <EmptyHint className="rounded-md border">{t("settings:webhook.noDeliveries")}</EmptyHint>
            : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("settings:webhook.colEvent")}</TableHead>
                        <TableHead>{t("settings:webhook.colStatus")}</TableHead>
                        <TableHead>{t("settings:webhook.colAttempts")}</TableHead>
                        <TableHead>{t("settings:webhook.colResponse")}</TableHead>
                        <TableHead>{t("settings:webhook.colTime")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(row => (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono text-xs">{row.event}</TableCell>
                          <TableCell>
                            <Badge variant={STATUS_VARIANT[row.status] ?? "outline"}>{t(`settings:webhook.status.${row.status}`)}</Badge>
                          </TableCell>
                          <TableCell>{row.attempts}</TableCell>
                          <TableCell className="max-w-64 truncate text-xs" title={row.error ?? undefined}>
                            {row.responseStatus ?? row.error ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
      </DialogContent>
    </Dialog>
  );
}
