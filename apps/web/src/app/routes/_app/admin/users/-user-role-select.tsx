// Per-row global-role select for the admin users table (PLAN-076). A user
// with a NULL `globalRoleId` resolves to the system default role server-side,
// so the default role is preselected when no explicit assignment exists.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { useGlobalRoles } from "@/shared/lib/api/global-roles";
import { errorMessage } from "@/shared/lib/errors";
import { http } from "@/shared/lib/http";

interface UserRoleSelectProps {
  readonly userId: string;
  readonly globalRoleId: string | null;
  readonly disabled?: boolean;
  readonly onAssigned: () => void;
}

export function UserRoleSelect({ userId, globalRoleId, disabled, onAssigned }: UserRoleSelectProps) {
  const { t } = useTranslation(["users", "common"]);
  const rolesQuery = useGlobalRoles();
  const [pending, setPending] = useState(false);

  const roles = rolesQuery.data ?? [];
  const defaultRole = roles.find(r => r.kind === "default");
  // NULL assignment falls back to the default role — preselect it.
  const value = globalRoleId ?? defaultRole?.id ?? "";

  if (roles.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  const assign = async (roleId: string) => {
    if (roleId === value || pending)
      return;
    setPending(true);
    try {
      await http(`/account/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ globalRoleId: roleId }),
      });
      toast.success(t("users:globalRole.toast.assigned"));
      onAssigned();
    }
    catch (err) {
      toast.error(errorMessage(err, t("common:common.error.operationFailed")));
    }
    finally {
      setPending(false);
    }
  };

  return (
    <Select
      value={value}
      onValueChange={v => v !== null && void assign(v)}
      disabled={disabled || pending}
    >
      <SelectTrigger className="w-40" aria-label={t("users:globalRole.label")}>
        <SelectValue>
          {(v: string) => roles.find(r => r.id === v)?.name ?? v}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {roles.map(r => (
          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
