import type { ResolvedMaintenanceTemplate } from "@/shared/lib/api/ships";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function parseList(value: string | null): readonly string[] | null {
  if (!value)
    return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every(item => typeof item === "string"))
      return parsed;
  }
  catch {
    return null;
  }
  return null;
}

function TemplateBlock({ title, value }: { readonly title: string; readonly value: string | null }) {
  const { t } = useTranslation("ships");
  const parsed = parseList(value);
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{title}</h4>
      {parsed !== null
        ? parsed.length === 0
          ? <p className="text-sm text-muted-foreground">{t("maintenance.reference.empty")}</p>
          : (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {parsed.map(item => <li key={item}>{item}</li>)}
              </ul>
            )
        : (
            <div className="prose prose-sm max-w-none text-sm dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{value ?? ""}</ReactMarkdown>
            </div>
          )}
    </section>
  );
}

export function MaintenanceTemplateReference({ template }: { readonly template: ResolvedMaintenanceTemplate | null | undefined }) {
  const { t } = useTranslation("ships");
  if (!template) {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        {t("maintenance.reference.missing")}
      </p>
    );
  }

  return (
    <div className="space-y-4 rounded-md border px-3 py-3">
      <div>
        <h3 className="text-sm font-medium">{template.name}</h3>
        {template.category && <p className="text-xs text-muted-foreground">{template.category}</p>}
      </div>
      <TemplateBlock title={t("maintenance.template.field.checklist")} value={template.checklist} />
      <TemplateBlock title={t("maintenance.template.field.precautions")} value={template.precautions} />
    </div>
  );
}
