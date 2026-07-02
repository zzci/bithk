// Form dialogs for the admin groups tab, extracted from groups.lazy.tsx:
// the create/edit group form, the modules-only editor for the built-in Default
// group, and the shared module on/off switch table both forms render.

import type { ModuleKey } from "@/shared/lib/modules";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { Table, TableBody, TableCell, TableRow } from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import { MODULE_KEYS } from "@/shared/lib/modules";
import { MODULE_LABEL_KEY } from "./-group-labels";

export function GroupFormDialog({
  initialName = "",
  initialDescription = "",
  initialModules = [],
  onSubmit,
  title,
  description,
  submitLabel,
}: {
  readonly initialName?: string;
  readonly initialDescription?: string;
  readonly initialModules?: readonly ModuleKey[];
  readonly onSubmit: (name: string, description: string, modules: readonly ModuleKey[]) => Promise<void>;
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
}) {
  const [name, setName] = useState(initialName);
  const [desc, setDesc] = useState(initialDescription);
  const [modules, setModules] = useState<readonly ModuleKey[]>(initialModules);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { t } = useTranslation("groups");

  const toggleModule = (key: ModuleKey) => {
    setModules(prev =>
      prev.includes(key) ? prev.filter(m => m !== key) : [...prev, key],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim())
      return;
    setSubmitting(true);
    setFormError(null);
    try {
      // Persist modules in registry order so the stored set is deterministic.
      await onSubmit(name.trim(), desc.trim(), MODULE_KEYS.filter(key => modules.includes(key)));
    }
    catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.error.operationFailed"));
    }
    finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={e => void handleSubmit(e)}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        {formError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="group-name">{t("field.name")}</Label>
          <Input
            id="group-name"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="group-desc">{t("field.description")}</Label>
          <Textarea
            id="group-desc"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={3}
          />
        </div>
        {/* Module grants (FEAT-032): the group's members see the union of
            their groups' modules. */}
        <div className="space-y-2">
          <Label>{t("field.modules")}</Label>
          <ModuleSwitchTable value={modules} onToggle={toggleModule} />
        </div>
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline">{t("common.cancel")}</Button>} />
        <Button type="submit" disabled={submitting || !name.trim()}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Shared module on/off table used by the group form and the Default-group
// modules dialog.
function ModuleSwitchTable({
  value,
  onToggle,
}: {
  readonly value: readonly ModuleKey[];
  readonly onToggle: (key: ModuleKey) => void;
}) {
  const { t } = useTranslation("groups");
  return (
    <div className="rounded-md border">
      <Table>
        <TableBody>
          {MODULE_KEYS.map(key => (
            <TableRow key={key}>
              <TableCell className="align-middle">
                <Label htmlFor={`group-module-${key}`} className="font-normal">{t(MODULE_LABEL_KEY[key])}</Label>
              </TableCell>
              <TableCell>
                <Switch
                  id={`group-module-${key}`}
                  checked={value.includes(key)}
                  onCheckedChange={() => onToggle(key)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// Modules-only editor for the built-in Default group (FEAT-043): no name or
// description, just the module switches.
export function DefaultModulesDialog({
  initialModules,
  onSubmit,
  title,
  description,
  submitLabel,
}: {
  readonly initialModules: readonly ModuleKey[];
  readonly onSubmit: (modules: readonly ModuleKey[]) => Promise<void>;
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
}) {
  const [modules, setModules] = useState<readonly ModuleKey[]>(initialModules);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { t } = useTranslation("groups");

  const toggleModule = (key: ModuleKey) => {
    setModules(prev =>
      prev.includes(key) ? prev.filter(m => m !== key) : [...prev, key],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      // Persist modules in registry order so the stored set is deterministic.
      await onSubmit(MODULE_KEYS.filter(key => modules.includes(key)));
    }
    catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.error.operationFailed"));
    }
    finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={e => void handleSubmit(e)}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        {formError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}
        <div className="space-y-2">
          <Label>{t("field.modules")}</Label>
          <ModuleSwitchTable value={modules} onToggle={toggleModule} />
        </div>
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline">{t("common.cancel")}</Button>} />
        <Button type="submit" disabled={submitting}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
