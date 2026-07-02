// Memoized list row for a user-defined group in the admin groups tab, with its
// hover-revealed edit dialog and delete action. Extracted from groups.lazy.tsx;
// memoized so dialog/search state changes in the tab do not re-render every
// group row. All callbacks must be stable for the memo to hold.

import type { AccountGroup } from "@/shared/lib/api/account";
import type { ModuleKey } from "@/shared/lib/modules";
import { Pencil, Trash2 } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { GroupFormDialog } from "./-group-dialogs";
import { MODULE_LABEL_KEY } from "./-group-labels";

interface GroupListRowProps {
  readonly group: AccountGroup;
  readonly active: boolean;
  /** This row's edit dialog is open (parent tracks a single editing target). */
  readonly editing: boolean;
  readonly onSelect: (id: string) => void;
  readonly onEditOpenChange: (group: AccountGroup, open: boolean) => void;
  readonly onSubmitEdit: (group: AccountGroup, name: string, description: string, modules: readonly ModuleKey[]) => Promise<void>;
  readonly onDelete: (group: AccountGroup) => void;
}

export const GroupListRow = memo(({
  group,
  active,
  editing,
  onSelect,
  onEditOpenChange,
  onSubmitEdit,
  onDelete,
}: GroupListRowProps) => {
  const { t } = useTranslation("groups");
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors",
        active
          ? "border-primary bg-primary/5"
          : "hover:bg-muted/50",
      )}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => onSelect(group.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(group.id);
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{group.name}</span>
          <Badge variant="secondary" className="shrink-0">{group.memberCount}</Badge>
        </div>
        {group.description && (
          <p className="text-xs text-muted-foreground truncate">{group.description}</p>
        )}
        {group.modules.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">
            {group.modules.map(k => t(MODULE_LABEL_KEY[k])).join(" · ")}
          </p>
        )}
      </div>
      <div
        className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[active=true]:opacity-100"
        data-active={active}
        onClick={e => e.stopPropagation()}
      >
        <Dialog
          open={editing}
          onOpenChange={open => onEditOpenChange(group, open)}
        >
          <DialogTrigger
            render={(
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("common.edit")}
                onClick={() => onEditOpenChange(group, true)}
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
          />
          <DialogContent>
            <GroupFormDialog
              initialName={group.name}
              initialDescription={group.description ?? ""}
              initialModules={group.modules}
              onSubmit={(name, description, modules) => onSubmitEdit(group, name, description, modules)}
              title={t("editTitle")}
              description={t("editDescription")}
              submitLabel={t("common.save")}
            />
          </DialogContent>
        </Dialog>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("common.delete")}
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(group)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
});
