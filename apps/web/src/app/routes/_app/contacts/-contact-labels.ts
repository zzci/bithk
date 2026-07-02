// Static label-key maps for the contact enums. Exhaustive `Record<Enum,
// string>` maps (instead of dynamic `t(`...${v}`)` template keys) keep every
// locale key visible to the i18n static analyzer (check-i18n), so unused-key
// detection stays trustworthy.

import type { ContactKind, ContactSensitivity, ContactStatus } from "@/shared/lib/api/contacts";

export const CONTACT_KIND_LABEL_KEY: Record<ContactKind, string> = {
  individual: "contacts:kind.individual",
  organization: "contacts:kind.organization",
};

export const CONTACT_STATUS_LABEL_KEY: Record<ContactStatus, string> = {
  active: "contacts:status.active",
  inactive: "contacts:status.inactive",
};

export const CONTACT_SENSITIVITY_LABEL_KEY: Record<ContactSensitivity, string> = {
  public: "contacts:sensitivity.public",
  private: "contacts:sensitivity.private",
  confidential: "contacts:sensitivity.confidential",
};
