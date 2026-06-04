// Organization pick-or-create field for the individual contact form. Mirrors the
// shared tags-combobox interaction: a dashed picker pill opens a searchable popup
// listing existing kind='organization' contacts, and offers to create a new one
// from the typed query. Picking an existing org links by id; creating sets a name
// the backend resolves/creates on save. A current selection renders as a single
// removable chip (single-select), so the picker is hidden until it is cleared.

import { Building2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/shared/components/ui/combobox";
import { Label } from "@/shared/components/ui/label";
import { useContacts } from "@/shared/lib/api/contacts";

interface ContactOrgComboboxProps {
  readonly organizationId: string | null;
  readonly organizationName: string;
  /** An existing organization was chosen (links by id). */
  readonly onPick: (org: { id: string; name: string }) => void;
  /** A new organization name was typed (created on save). */
  readonly onCreate: (name: string) => void;
  readonly onClear: () => void;
}

export function ContactOrgCombobox({
  organizationId,
  organizationName,
  onPick,
  onCreate,
  onClear,
}: ContactOrgComboboxProps) {
  const { t } = useTranslation("contacts");
  const orgsQuery = useContacts({ kind: "organization" });
  const orgs = orgsQuery.data ?? [];
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const matches = orgs.filter(o => o.name.toLowerCase().includes(q));
  const canCreate = trimmed.length > 0 && !orgs.some(o => o.name.toLowerCase() === q);

  // A linked id, or a typed-but-not-yet-saved name, both count as a selection.
  const hasSelection = organizationId !== null || organizationName.trim() !== "";
  const isNew = organizationId === null && organizationName.trim() !== "";

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{t("field.organization")}</Label>

      {hasSelection
        ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="gap-1 pr-1 text-xs font-normal">
                {organizationName}
                {isNew && <span className="text-muted-foreground">{t("org.newHint")}</span>}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("org.clear")}
                  onClick={onClear}
                  className="-mr-0.5 rounded-sm hover:text-destructive"
                >
                  <X className="size-3" />
                </Button>
              </Badge>
            </div>
          )
        : (
            <Combobox
              value={null as string | null}
              onValueChange={(value) => {
                if (value == null)
                  return;
                const org = orgs.find(o => o.name === value);
                if (org)
                  onPick({ id: org.id, name: org.name });
                else
                  onCreate(value);
              }}
              onInputValueChange={setQuery}
            >
              <ComboboxTrigger className="inline-flex h-9 w-full items-center justify-start gap-1.5 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <Building2 className="size-3.5" aria-hidden="true" />
                {t("org.placeholder")}
              </ComboboxTrigger>
              <ComboboxContent>
                <ComboboxInput showTrigger={false} placeholder={t("org.searchPlaceholder")} />
                <ComboboxList>
                  {matches.length === 0 && !canCreate && (
                    <p className="px-2 py-4 text-center text-sm text-muted-foreground">{t("org.empty")}</p>
                  )}
                  {matches.map(org => (
                    <ComboboxItem key={org.id} value={org.name}>{org.name}</ComboboxItem>
                  ))}
                  {canCreate && (
                    <ComboboxItem value={trimmed}>{t("org.create", { name: trimmed })}</ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          )}
    </div>
  );
}
