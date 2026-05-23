// Team directory create/rename dialog, shared by the drive sidebar (which now
// lists team directories inline and hosts their management).

import type { FormEvent } from "react";
import type { TeamDirectory } from "@/shared/lib/api/drive";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

import { Textarea } from "@/shared/components/ui/textarea";
import {
  useCreateTeamDirectory,
  useUpdateTeamDirectory,
} from "@/shared/lib/api/drive";

export type EditState
  = | { readonly type: "create" }
    | { readonly type: "rename"; readonly directory: TeamDirectory }
    | null;

export function DirectoryEditDialog({ state, onClose }: {
  readonly state: EditState;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation(["drive", "common"]);
  const createDirectory = useCreateTeamDirectory();
  const updateDirectory = useUpdateTeamDirectory();
  const isRename = state?.type === "rename";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Seed fields whenever a new dialog target opens.
  const target = state?.type === "rename" ? state.directory : null;
  const [seededId, setSeededId] = useState<string | null>(null);
  const currentId = target?.id ?? (state?.type === "create" ? "__create__" : null);
  if (currentId !== seededId) {
    setSeededId(currentId);
    setName(target?.name ?? "");
    setDescription(target?.description ?? "");
  }

  const pending = createDirectory.isPending || updateDirectory.isPending;
  const error = createDirectory.error ?? updateDirectory.error;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed)
      return;
    const payload = { name: trimmed, description: description.trim() || null };
    if (state?.type === "rename") {
      updateDirectory.mutate({ id: state.directory.id, ...payload }, { onSuccess: onClose });
    }
    else {
      createDirectory.mutate(payload, { onSuccess: onClose });
    }
  };

  return (
    <Dialog open={state !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{isRename ? t("drive:team.edit.renameTitle") : t("drive:team.edit.createTitle")}</DialogTitle>
            <DialogDescription>{isRename ? t("drive:team.edit.renameDescription") : t("drive:team.edit.createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="team-dir-name">{t("drive:team.col.name")}</Label>
            <Input id="team-dir-name" autoFocus value={name} onChange={e => setName(e.currentTarget.value)} placeholder={t("drive:team.edit.namePlaceholder")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="team-dir-desc">{t("drive:team.edit.description")}</Label>
            <Textarea id="team-dir-desc" value={description} onChange={e => setDescription(e.currentTarget.value)} placeholder={t("drive:team.edit.descriptionPlaceholder")} />
          </div>
          {error && <p className="text-sm text-destructive">{error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("common:common.cancel")}</Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? t("common:common.saving") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
