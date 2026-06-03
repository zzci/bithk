import type { EntitiesResponse, RelationTuple, TuplesResponse } from "./-policies-shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ListFilter } from "@/shared/components/list-filter";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/shared/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { errorMessage } from "@/shared/lib/errors";
import { formatDate } from "@/shared/lib/format";
import { http } from "@/shared/lib/http";
import { handleSelect, NAMESPACES, RELATIONS, SUBJECT_NAMESPACES, useEntities, useEntityNameMap } from "./-policies-shared";

export function TupleManager() {
  const { t } = useTranslation("policies");
  const [filterNs, setFilterNs] = useState<string>("__all__");
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const { data: entities } = useEntities();
  const nameMap = useEntityNameMap(entities);

  const params = new URLSearchParams();
  if (filterNs !== "__all__")
    params.set("namespace", filterNs);
  params.set("page", String(page));
  params.set("limit", "20");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tuples", filterNs, page],
    queryFn: () => http<TuplesResponse>(`/tuples?${params.toString()}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => http(`/tuples/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tuples"] }),
    onError: err => toast.error(errorMessage(err, t("common.error.deleteFailed", { ns: "common" }))),
  });

  const tuples = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  function resolveEntityName(id: string): string {
    const name = nameMap.get(id);
    return name ? `${name} (${id})` : id;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <ListFilter
            dimensions={[
              {
                key: "namespace",
                label: t("namespace"),
                mode: "single",
                defaultValue: "__all__",
                value: filterNs,
                onChange: (value) => {
                  setFilterNs(value ?? "__all__");
                  setPage(1);
                },
                options: NAMESPACES.map(ns => ({ value: ns, label: t(`ns.${ns}`) })),
              },
            ]}
          />
        </div>
        <CreateTupleDialog entities={entities} />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.namespace")}</TableHead>
              <TableHead>{t("col.object")}</TableHead>
              <TableHead>{t("col.relation")}</TableHead>
              <TableHead>{t("col.subject")}</TableHead>
              <TableHead>{t("col.created")}</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("loading")}</TableCell>
                  </TableRow>
                )
              : isError
                ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8">
                        <div className="flex flex-col items-center gap-2">
                          <span className="text-sm text-destructive">{t("common.error.loadFailed", { ns: "common" })}</span>
                          <Button variant="outline" size="sm" onClick={() => void refetch()}>{t("common.retry", { ns: "common" })}</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                : tuples.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("noTuples")}</TableCell>
                      </TableRow>
                    )
                  : tuples.map(tuple => (
                      <TableRow key={tuple.id}>
                        <TableCell><Badge variant="outline">{t(`ns.${tuple.namespace}`)}</Badge></TableCell>
                        <TableCell className="text-sm">{resolveEntityName(tuple.objectId)}</TableCell>
                        <TableCell><Badge variant="secondary">{t(`rel.${tuple.relation}`)}</Badge></TableCell>
                        <TableCell className="text-sm">
                          <Badge variant="outline" className="mr-1">{t(`ns.${tuple.subjectNamespace}`)}</Badge>
                          {resolveEntityName(tuple.subjectId)}
                          {tuple.subjectRelation
                            ? (
                                <Badge variant="secondary" className="ml-1">
                                  #
                                  {t(`rel.${tuple.subjectRelation}`)}
                                </Badge>
                              )
                            : ""}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(tuple.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <EditTupleDialog tuple={tuple} />
                            <Button
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteMutation.mutate(tuple.id)}
                              disabled={deleteMutation.isPending}
                            >
                              {t("common.delete")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{t("totalTuples", { count: total })}</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              {t("common.prev")}
            </Button>
            <span className="flex items-center text-sm px-2">
              {page}
              {" "}
              /
              {" "}
              {totalPages}
            </span>
            <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateTupleDialog({ entities }: { readonly entities: EntitiesResponse | undefined }) {
  const { t } = useTranslation("policies");
  const [open, setOpen] = useState(false);
  const [ns, setNs] = useState<string>(NAMESPACES[0]);
  const [objectId, setObjectId] = useState("");
  const [relation, setRelation] = useState("");
  const [subjectNs, setSubjectNs] = useState("user");
  const [subjectId, setSubjectId] = useState("");
  const [subjectRelation, setSubjectRelation] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => http("/policy/tuples", {
      method: "POST",
      body: JSON.stringify({
        namespace: ns,
        objectId,
        relation,
        subjectNamespace: subjectNs,
        subjectId,
        subjectRelation: subjectRelation || null,
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tuples"] });
      setOpen(false);
      resetForm();
    },
  });

  function resetForm() {
    setObjectId("");
    setRelation("");
    setSubjectId("");
    setSubjectRelation("");
  }

  const availableRelations = RELATIONS[ns] ?? [];
  const objectOptions = entities?.data?.[ns] ?? [];
  const subjectOptions = entities?.data?.[subjectNs] ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>{t("createTuple")}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
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
          </div>

          <div className="space-y-2">
            <Label>{t("relation")}</Label>
            <Select value={relation} onValueChange={handleSelect(setRelation)}>
              <SelectTrigger><SelectValue>{(v: string) => v ? t(`rel.${v}`) : t("selectRelation")}</SelectValue></SelectTrigger>
              <SelectContent>
                {availableRelations.map(r => <SelectItem key={r} value={r}>{t(`rel.${r}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("subjectNamespace")}</Label>
              <Select
                value={subjectNs}
                onValueChange={handleSelect((v) => {
                  setSubjectNs(v);
                  setSubjectId("");
                  setSubjectRelation(v === "group" ? "member" : "");
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

          {subjectNs === "group" && (
            <div className="space-y-2">
              <Label>{t("subjectRelation")}</Label>
              <Input value={subjectRelation} onChange={e => setSubjectRelation(e.target.value)} placeholder={t("subjectRelationPlaceholder")} />
            </div>
          )}
        </div>

        {mutation.error && (
          <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!objectId || !relation || !subjectId || mutation.isPending}
          >
            {mutation.isPending ? t("creating") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTupleDialog({ tuple }: { readonly tuple: RelationTuple }) {
  const { t } = useTranslation("policies");
  const [open, setOpen] = useState(false);
  const [relation, setRelation] = useState(tuple.relation);
  const queryClient = useQueryClient();

  const availableRelations = RELATIONS[tuple.namespace] ?? [];

  const mutation = useMutation({
    mutationFn: () => http(`/tuples/${tuple.id}`, {
      method: "PATCH",
      body: JSON.stringify({ relation }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tuples"] });
      setOpen(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v)
          setRelation(tuple.relation);
      }}
    >
      <DialogTrigger render={<Button variant="ghost">{t("common.edit")}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editTupleTitle")}</DialogTitle>
          <DialogDescription>{t("editTupleDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t("relation")}</Label>
            <Select value={relation} onValueChange={handleSelect(setRelation)}>
              <SelectTrigger><SelectValue>{(v: string) => v ? t(`rel.${v}`) : t("selectRelation")}</SelectValue></SelectTrigger>
              <SelectContent>
                {availableRelations.map(r => <SelectItem key={r} value={r}>{t(`rel.${r}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {mutation.error && (
          <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={relation === tuple.relation || mutation.isPending}
          >
            {mutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
