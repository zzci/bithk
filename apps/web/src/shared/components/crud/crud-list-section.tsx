// Presentational section chrome for the admin CRUD vocabularies: the header
// (title / description / "add" button), a load-error banner, the bordered table
// (column headers + empty row + data rows ending in an edit/delete action pair),
// and a trailing slot for the caller-owned dialogs (delete confirm + create/edit).
//
// The caller owns all data, mutations, toasts, and permission decisions: it
// passes the already-translated header/action strings, the rows, a per-row cell
// renderer, and the edit/delete handlers. Action labels are passed in because
// they vary by namespace across consumers (common vs settings).

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

interface CrudColumn {
  readonly header: string;
  /** Tailwind width class for the column head, e.g. `"w-32"`. */
  readonly className?: string;
}

interface CrudRow {
  readonly id: string;
}

interface CrudListSectionProps<TRow extends CrudRow> {
  readonly title: string;
  readonly description: string;
  readonly addLabel: string;
  readonly onAdd: () => void;
  /** Already-resolved load-error message; `null`/`undefined` renders nothing. */
  readonly errorMessage?: string | null;
  /** Leading data columns (the trailing actions column is appended internally). */
  readonly columns: readonly CrudColumn[];
  readonly actionsLabel: string;
  /** Width class for the appended actions column head. */
  readonly actionsClassName?: string;
  readonly rows: readonly TRow[];
  readonly emptyLabel: string;
  /** Renders the leading cells for a row (excluding the actions cell). */
  readonly renderRow: (row: TRow) => ReactNode;
  readonly editLabel: string;
  readonly deleteLabel: string;
  readonly onEdit: (row: TRow) => void;
  readonly onDelete: (row: TRow) => void;
  /** Caller-owned dialogs (delete confirm + create/edit). */
  readonly children?: ReactNode;
}

export function CrudListSection<TRow extends CrudRow>({
  title,
  description,
  addLabel,
  onAdd,
  errorMessage,
  columns,
  actionsLabel,
  actionsClassName = "w-32",
  rows,
  emptyLabel,
  renderRow,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
  children,
}: CrudListSectionProps<TRow>) {
  const colSpan = columns.length + 1;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button onClick={onAdd}>
          <Plus className="mr-1 size-3" />
          {addLabel}
        </Button>
      </div>

      <ErrorBanner message={errorMessage} />

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map(column => (
                <TableHead key={column.header} className={column.className}>{column.header}</TableHead>
              ))}
              <TableHead className={actionsClassName}>{actionsLabel}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0
              ? <TableRow><TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">{emptyLabel}</TableCell></TableRow>
              : rows.map(row => (
                  <TableRow key={row.id}>
                    {renderRow(row)}
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" onClick={() => onEdit(row)}>
                          {editLabel}
                        </Button>
                        <Button variant="ghost" className="text-destructive" onClick={() => onDelete(row)}>
                          {deleteLabel}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      {children}
    </section>
  );
}
