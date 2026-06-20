// Form value model + seed helpers for the procurement create / edit form,
// split out of `-project-procurement-form.tsx` so that component file only
// exports a component (react-refresh constraint), mirroring the colleague
// `-colleague-form-logic.ts` split.

import type {
  ProcurementPriority,
  ProcurementRow,
  ProcurementStatus,
} from "@/shared/lib/api/procurement";

// "no selection" sentinel for the supplier / category / assignee Selects (which
// cannot hold ""). The panel/tab map it back to null/absent on submit.
export const PROCUREMENT_FORM_NONE = "__none__";

export type ProcurementFormMode = "create" | "edit";

export interface ProcurementFormValues {
  readonly itemName: string;
  readonly title: string;
  readonly supplierId: string;
  readonly categoryId: string;
  readonly quantity: string;
  readonly amount: number | null;
  readonly currency: string;
  // Workflow fields — only edited in create mode.
  readonly status: ProcurementStatus;
  readonly priority: ProcurementPriority;
  readonly dueDate: string;
  readonly assigneeMemberId: string;
  readonly description: string;
  readonly tags: readonly string[];
}

export const EMPTY_PROCUREMENT_FORM: ProcurementFormValues = {
  itemName: "",
  title: "",
  supplierId: PROCUREMENT_FORM_NONE,
  categoryId: PROCUREMENT_FORM_NONE,
  quantity: "",
  amount: null,
  currency: "",
  status: "requested",
  priority: "low",
  dueDate: "",
  assigneeMemberId: PROCUREMENT_FORM_NONE,
  description: "",
  tags: [],
};

/** Seed the edit form from an existing row (item-detail fields only matter). */
export function procurementFormFromRow(row: ProcurementRow): ProcurementFormValues {
  return {
    itemName: row.itemName,
    title: row.title ?? "",
    supplierId: row.supplierId ?? PROCUREMENT_FORM_NONE,
    categoryId: row.categoryId ?? PROCUREMENT_FORM_NONE,
    quantity: row.quantity === null ? "" : String(row.quantity),
    amount: row.amount,
    currency: row.currency ?? "",
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate ?? "",
    assigneeMemberId: row.assigneeMemberId ?? PROCUREMENT_FORM_NONE,
    description: row.description ?? "",
    tags: row.tags.map(tag => tag.name),
  };
}
