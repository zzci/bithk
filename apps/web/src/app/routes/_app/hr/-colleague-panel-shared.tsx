// Shared leaf pieces of the colleague panel (view + form modes): the panel
// props contract and the section / definition-list primitives. Extracted from
// -colleague-panel.tsx.

import type { AssignableUserOption, ColleagueForm } from "./-colleague-form-logic";
import type { HrColleagueRow } from "@/shared/lib/api/hr";

export type ColleaguePanelMode = "create" | "view" | "edit";

export interface ColleaguePanelProps {
  readonly mode: ColleaguePanelMode;
  readonly colleague: HrColleagueRow | null;
  readonly users: readonly AssignableUserOption[];
  readonly pending: boolean;
  readonly errorMessage: string | null;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onArchive: () => void;
  readonly onSubmit: (form: ColleagueForm) => void;
  /** Cancel the form: edit returns to view of the same colleague, create closes. */
  readonly onCancel: () => void;
}

export function PanelSection({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function ViewGrid({ children }: { readonly children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-6 gap-y-4 @sm:grid-cols-2">{children}</dl>;
}

export function ViewField({ label, value }: { readonly label: string; readonly value: string | null }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        {value
          ? <span className="break-words text-foreground">{value}</span>
          : <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}
