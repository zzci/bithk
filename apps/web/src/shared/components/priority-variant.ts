// Priority → shadcn Badge variant. Single source of truth shared by the issue
// and procurement detail panels, which previously each kept a verbatim copy
// guarded by a "keep in sync" comment. Issue and procurement priorities are the
// same four-level union, so a local type keeps this module free of feature
// imports.

type Priority = "low" | "medium" | "high" | "urgent";

export const PRIORITY_BADGE_VARIANT: Record<Priority, "default" | "outline" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  urgent: "destructive",
};
