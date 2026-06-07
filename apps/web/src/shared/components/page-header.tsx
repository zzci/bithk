import type { ReactNode } from "react";

interface PageHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

/**
 * Standard list/detail page header: a bold `<h1>` title with an optional
 * muted description line, and an optional right-aligned actions slot. When
 * `actions` is provided, title and actions sit in a `justify-between` row.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  const heading = (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      {description != null && <p className="mt-1 text-muted-foreground">{description}</p>}
    </div>
  );

  if (actions == null) {
    return <div className={className}>{heading}</div>;
  }

  return (
    <div className={`flex items-start justify-between gap-4 ${className ?? ""}`.trim()}>
      {heading}
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}
