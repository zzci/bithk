import type { CheckResponse } from "./-policies-shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/shared/components/ui/combobox";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { http } from "@/shared/lib/http";
import { handleSelect, NAMESPACES, RELATIONS, SUBJECT_NAMESPACES, useEntities } from "./-policies-shared";

export function PermissionChecker() {
  const { t } = useTranslation("policies");
  const [ns, setNs] = useState<string>(NAMESPACES[0]);
  const [objectId, setObjectId] = useState("");
  const [relation, setRelation] = useState("");
  const [subjectNs, setSubjectNs] = useState("user");
  const [subjectId, setSubjectId] = useState("");
  const [result, setResult] = useState<CheckResponse["data"] | null>(null);
  const { data: entities } = useEntities();

  const mutation = useMutation({
    mutationFn: () => http<CheckResponse>("/policy/check", {
      method: "POST",
      body: JSON.stringify({
        namespace: ns,
        objectId,
        relation,
        subjectNamespace: subjectNs,
        subjectId,
      }),
    }),
    onSuccess: data => setResult(data.data),
  });

  const availableRelations = RELATIONS[ns] ?? [];
  const objectOptions = entities?.data?.[ns] ?? [];
  const subjectOptions = entities?.data?.[subjectNs] ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("permissionCheck")}</CardTitle>
        <CardDescription>
          {t("checkDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("namespace")}</Label>
            <Select
              value={ns}
              onValueChange={handleSelect((v) => {
                setNs(v);
                setRelation("");
                setObjectId("");
              })}
            >
              <SelectTrigger><SelectValue>{(v: string) => t(`ns.${v}`)}</SelectValue></SelectTrigger>
              <SelectContent>
                {NAMESPACES.map(n => <SelectItem key={n} value={n}>{t(`ns.${n}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("object")}</Label>
            <Combobox value={objectId ? { value: objectId, label: objectOptions.find(o => o.id === objectId)?.name ?? objectId } : null} onValueChange={v => setObjectId(v?.value ?? "")} isItemEqualToValue={(a, b) => a.value === b.value}>
              <ComboboxInput placeholder={t("selectObject")} showClear />
              <ComboboxContent>
                <ComboboxList>
                  {objectOptions.map(o => (
                    <ComboboxItem key={o.id} value={{ value: o.id, label: o.name }}>
                      {o.name}
                      {" "}
                      (
                      {o.id}
                      )
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="space-y-2">
            <Label>{t("relation")}</Label>
            <Select value={relation} onValueChange={handleSelect(setRelation)}>
              <SelectTrigger><SelectValue>{(v: string) => v ? t(`rel.${v}`) : t("select")}</SelectValue></SelectTrigger>
              <SelectContent>
                {availableRelations.map(r => <SelectItem key={r} value={r}>{t(`rel.${r}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("subjectNamespace")}</Label>
            <Select
              value={subjectNs}
              onValueChange={handleSelect((v) => {
                setSubjectNs(v);
                setSubjectId("");
              })}
            >
              <SelectTrigger><SelectValue>{(v: string) => t(`ns.${v}`)}</SelectValue></SelectTrigger>
              <SelectContent>
                {SUBJECT_NAMESPACES.map(n => <SelectItem key={n} value={n}>{t(`ns.${n}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("subject")}</Label>
            <Combobox value={subjectId ? { value: subjectId, label: subjectOptions.find(o => o.id === subjectId)?.name ?? subjectId } : null} onValueChange={v => setSubjectId(v?.value ?? "")} isItemEqualToValue={(a, b) => a.value === b.value}>
              <ComboboxInput placeholder={t("selectSubject")} showClear />
              <ComboboxContent>
                <ComboboxList>
                  {subjectOptions.map(o => (
                    <ComboboxItem key={o.id} value={{ value: o.id, label: o.name }}>
                      {o.name}
                      {" "}
                      (
                      {o.id}
                      )
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
        </div>

        <Button
          onClick={() => mutation.mutate()}
          disabled={!objectId || !relation || !subjectId || mutation.isPending}
        >
          {mutation.isPending ? t("checking") : t("checkPermission")}
        </Button>

        {mutation.error && (
          <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
        )}

        {result && (
          <div className={`rounded-lg border p-4 ${result.allowed ? "border-success/50 bg-success/5" : "border-destructive/50 bg-destructive/5"}`}>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={result.allowed ? "default" : "destructive"}>
                {result.allowed ? t("allowed") : t("denied")}
              </Badge>
              <span className="text-sm font-mono">
                {ns}
                :
                {objectId}
                #
                {relation}
                @
                {subjectNs}
                :
                {subjectId}
              </span>
            </div>
            {result.resolvedThrough.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-muted-foreground">{t("resolvedThrough")}</p>
                {result.resolvedThrough.map(path => (
                  <p key={path} className="text-xs font-mono pl-4">{path}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
