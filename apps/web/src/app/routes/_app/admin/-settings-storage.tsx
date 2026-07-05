import type { SaveStorageConfigInput, UploadDriver } from "@/shared/lib/api/storage";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PaginationFooter } from "@/shared/components/pagination-footer";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { EmptyHint } from "@/shared/components/ui/centered-hint";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  useSaveStorageConfig,
  useStorageConfig,
  useStorageFiles,
  useSyncToS3,
} from "@/shared/lib/api/storage";
import { errorMessage } from "@/shared/lib/errors";
import { formatBytes } from "@/shared/lib/format";

export function StorageSettingsTab() {
  return (
    <div className="space-y-6">
      <StorageConfigSection />
      <StorageFilesSection />
    </div>
  );
}

function StorageConfigSection() {
  const { t } = useTranslation(["settings", "common"]);
  const configQuery = useStorageConfig();
  const save = useSaveStorageConfig();

  const [uploadDriver, setUploadDriver] = useState<UploadDriver>("local");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [prefix, setPrefix] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cfg = configQuery.data;

  // Seed the form from the loaded config once (the secret stays blank — it is
  // write-only; a `secretConfigured` hint tells the admin one is saved).
  useEffect(() => {
    if (!cfg)
      return;
    setUploadDriver(cfg.uploadDriver);
    setBucket(cfg.s3.bucket);
    setRegion(cfg.s3.region);
    setEndpoint(cfg.s3.endpoint);
    setAccessKeyId(cfg.s3.accessKeyId);
    setPrefix(cfg.s3.prefix);
  }, [cfg]);

  const handleSave = () => {
    setError(null);
    const input: SaveStorageConfigInput = {
      uploadDriver,
      s3: {
        bucket,
        region,
        endpoint,
        accessKeyId,
        prefix,
        // Only send the secret when the admin typed one; blank = keep existing.
        ...(secret ? { secret } : {}),
      },
    };
    save.mutate(input, {
      onSuccess: () => {
        setSecret("");
        toast.success(t("settings:storage.config.saved"));
      },
      onError: err => setError(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings:storage.config.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("settings:storage.config.description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorBanner message={error} />}

        <div className="space-y-2 max-w-sm">
          <Label htmlFor="upload-driver">{t("settings:storage.config.uploadDriver")}</Label>
          <Select value={uploadDriver} onValueChange={v => setUploadDriver(v as UploadDriver)}>
            <SelectTrigger id="upload-driver">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">{t("settings:storage.config.driverLocal")}</SelectItem>
              <SelectItem value="s3">{t("settings:storage.config.driverS3")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <h3 className="text-sm font-medium">{t("settings:storage.config.s3Title")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="s3-bucket" label={t("settings:storage.config.bucket")} value={bucket} onChange={setBucket} />
            <Field id="s3-region" label={t("settings:storage.config.region")} value={region} onChange={setRegion} placeholder="auto" />
            <Field id="s3-endpoint" label={t("settings:storage.config.endpoint")} value={endpoint} onChange={setEndpoint} placeholder="https://…" />
            <Field id="s3-access-key" label={t("settings:storage.config.accessKeyId")} value={accessKeyId} onChange={setAccessKeyId} />
            <Field id="s3-prefix" label={t("settings:storage.config.prefix")} value={prefix} onChange={setPrefix} />
            <div className="space-y-2">
              <Label htmlFor="s3-secret">{t("settings:storage.config.secret")}</Label>
              <Input
                id="s3-secret"
                type="password"
                value={secret}
                autoComplete="new-password"
                placeholder={t("settings:storage.config.secretPlaceholder")}
                onChange={e => setSecret(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {cfg?.s3.secretConfigured
                  ? t("settings:storage.config.secretConfigured")
                  : t("settings:storage.config.secretNotConfigured")}
              </p>
            </div>
          </div>
        </div>

        <div>
          <Button onClick={handleSave} disabled={save.isPending}>
            {t("settings:storage.config.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}

function Field({ id, label, value, onChange, placeholder }: FieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

const LOCATION_BADGE: Record<string, "default" | "secondary" | "outline"> = {
  db: "default",
  s3: "secondary",
  local: "outline",
};

function StorageFilesSection() {
  const { t } = useTranslation(["settings", "common"]);
  const [page, setPage] = useState(1);
  const filesQuery = useStorageFiles(page);
  const sync = useSyncToS3();
  const [error, setError] = useState<string | null>(null);

  const meta = filesQuery.data?.meta;
  const rows = filesQuery.data?.data ?? [];
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.limit)) : 1;

  const handleSync = () => {
    setError(null);
    sync.mutate(undefined, {
      onSuccess: summary => toast.success(t("settings:storage.files.syncResult", {
        moved: summary.moved,
        skipped: summary.skipped,
        failed: summary.failed,
      })),
      onError: err => setError(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t("settings:storage.files.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("settings:storage.files.description")}</p>
        </div>
        <Button variant="outline" onClick={handleSync} disabled={sync.isPending}>
          {sync.isPending ? t("settings:storage.files.syncing") : t("settings:storage.files.syncToS3")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorBanner message={error} />}

        {rows.length === 0
          ? <EmptyHint>{t("settings:storage.files.empty")}</EmptyHint>
          : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("settings:storage.files.colName")}</TableHead>
                    <TableHead>{t("settings:storage.files.colScope")}</TableHead>
                    <TableHead>{t("settings:storage.files.colType")}</TableHead>
                    <TableHead>{t("settings:storage.files.colSize")}</TableHead>
                    <TableHead>{t("settings:storage.files.colLocation")}</TableHead>
                    <TableHead>{t("settings:storage.files.colUploader")}</TableHead>
                    <TableHead>{t("settings:storage.files.colDate")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(f => (
                    <TableRow key={f.id}>
                      <TableCell className="max-w-[16rem] truncate font-medium">{f.name}</TableCell>
                      <TableCell className="text-muted-foreground">{f.ownerScope ?? "—"}</TableCell>
                      <TableCell className="max-w-[10rem] truncate text-muted-foreground">{f.mimetype}</TableCell>
                      <TableCell className="tabular-nums">{formatBytes(f.size)}</TableCell>
                      <TableCell>
                        <Badge variant={LOCATION_BADGE[f.storageDriver] ?? "outline"}>{f.storageDriver}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{f.uploadedByName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {f.createdAt ? new Date(f.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

        {totalPages > 1 && meta && (
          <PaginationFooter
            page={page}
            totalPages={totalPages}
            totalLabel={t("settings:storage.files.total", { count: meta.total })}
            onPrev={() => setPage(p => p - 1)}
            onNext={() => setPage(p => p + 1)}
          />
        )}
      </CardContent>
    </Card>
  );
}
