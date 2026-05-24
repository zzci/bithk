import type { ContactView } from "@/shared/lib/api/contacts";
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
import { useGrantContact, useRevokeContact } from "@/shared/lib/api/contacts";
import { errorMessage } from "@/shared/lib/errors";

type ShareTargetType = "user" | "group";

export function ContactShareDialog({
  contact,
  open,
  onOpenChange,
}: {
  readonly contact: ContactView | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(["contacts", "common"]);
  const [targetType, setTargetType] = useState<ShareTargetType>("user");
  const [targetId, setTargetId] = useState("");
  const grant = useGrantContact();
  const revoke = useRevokeContact();
  const pending = grant.isPending || revoke.isPending;
  const disabled = !contact || !targetId.trim() || pending;

  const payload = () => {
    const id = targetId.trim();
    return targetType === "user" ? { userId: id } : { groupId: id };
  };

  const closeOnSuccess = () => {
    setTargetId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("share.title")}</DialogTitle>
          <DialogDescription>{t("share.description", { name: contact?.name ?? "" })}</DialogDescription>
        </DialogHeader>

        {(grant.error || revoke.error) && (
          <ErrorBanner message={errorMessage(grant.error ?? revoke.error, t("common:common.error.operationFailed"))} />
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[9rem_1fr]">
          <div className="space-y-1.5">
            <Label>{t("share.targetType")}</Label>
            <Select value={targetType} onValueChange={v => v !== null && setTargetType(v as ShareTargetType)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => t(`share.${v}` as const)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">{t("share.user")}</SelectItem>
                <SelectItem value="group">{t("share.group")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-share-target">{t("share.targetId")}</Label>
            <Input
              id="contact-share-target"
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              placeholder={targetType === "user" ? t("share.userPlaceholder") : t("share.groupPlaceholder")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:common.cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => contact && revoke.mutate({ id: contact.id, ...payload() }, { onSuccess: closeOnSuccess })}
          >
            {t("share.revoke")}
          </Button>
          <Button
            type="button"
            disabled={disabled}
            onClick={() => contact && grant.mutate({ id: contact.id, ...payload() }, { onSuccess: closeOnSuccess })}
          >
            {t("share.grant")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
