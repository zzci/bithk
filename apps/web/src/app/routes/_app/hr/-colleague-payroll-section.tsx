// Read-only payroll-history section for the colleague detail panel: the
// colleague's payroll records rendered as a compact table with per-currency
// net totals from the server-computed list meta. Create / edit / mark-paid
// stay on the payroll tab — this section only answers "what has this person
// been paid?" without leaving the drawer.

import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { useHrPayrollRecords } from "@/shared/lib/api/hr-payroll";
import { errorMessage } from "@/shared/lib/errors";
import { formatDateTime, formatMoney } from "@/shared/lib/format";
import { PanelSection } from "./-colleague-panel-shared";

// The panel shows only the most recent page; meta.total / meta.totals still
// cover the colleague's entire history.
const HISTORY_LIMIT = 12;

export function ColleaguePayrollSection({ colleagueId }: { readonly colleagueId: string }) {
  const { t } = useTranslation("hr");
  const query = useHrPayrollRecords({ colleagueId, limit: HISTORY_LIMIT });

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totals = meta?.totals ?? [];
  const amount = (value: number, currency: string) => `${formatMoney(value)} ${currency}`;

  return (
    <PanelSection title={t("colleagues.section.payrollHistory")}>
      {query.error
        ? <ErrorBanner message={errorMessage(query.error, t("common.error.loadFailed"))} />
        : query.isLoading
          ? <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
          : rows.length === 0
            ? <div className="text-sm text-muted-foreground">{t("payroll.noResults")}</div>
            : (
                <div className="space-y-2">
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("payroll.col.period")}</TableHead>
                          <TableHead className="text-right">{t("payroll.col.baseSalary")}</TableHead>
                          <TableHead className="text-right">{t("payroll.col.bonus")}</TableHead>
                          <TableHead className="text-right">{t("payroll.col.deduction")}</TableHead>
                          <TableHead className="text-right">{t("payroll.col.netAmount")}</TableHead>
                          <TableHead>{t("payroll.col.status")}</TableHead>
                          <TableHead>{t("payroll.col.paidAt")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map(record => (
                          <TableRow key={record.id}>
                            <TableCell>{record.period}</TableCell>
                            <TableCell className="text-right tabular-nums">{amount(record.baseSalary, record.currency)}</TableCell>
                            <TableCell className="text-right tabular-nums">{amount(record.bonus, record.currency)}</TableCell>
                            <TableCell className="text-right tabular-nums">{amount(record.deduction, record.currency)}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{amount(record.netAmount, record.currency)}</TableCell>
                            <TableCell>
                              <Badge variant={record.status === "paid" ? "default" : "secondary"}>
                                {t(`payroll.status.${record.status}`)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {record.paidAt ? formatDateTime(record.paidAt) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      {totals.length > 0 && (
                        <TableFooter>
                          {totals.map(total => (
                            <TableRow key={total.currency}>
                              <TableCell colSpan={4} className="text-right font-medium">
                                {`${t("payroll.summaryLabel")} · ${total.currency}`}
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums">
                                {`${formatMoney(total.net)} ${total.currency}`}
                              </TableCell>
                              <TableCell colSpan={2} />
                            </TableRow>
                          ))}
                        </TableFooter>
                      )}
                    </Table>
                  </div>
                  {meta && meta.total > rows.length && (
                    <div className="text-xs text-muted-foreground">
                      {t("colleagues.payrollHistoryCount", { shown: rows.length, total: meta.total })}
                    </div>
                  )}
                </div>
              )}
    </PanelSection>
  );
}
