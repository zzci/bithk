// Static label-key map for the module registry. An exhaustive
// `Record<ModuleKey, string>` map (instead of a dynamic `t(`modules.${k}`)`
// template key) keeps every locale key visible to the i18n static analyzer
// (check-i18n), so unused-key detection stays trustworthy.

import type { ModuleKey } from "@/shared/lib/modules";

export const MODULE_LABEL_KEY: Record<ModuleKey, string> = {
  documents: "groups:modules.documents",
  drive: "groups:modules.drive",
  projects: "groups:modules.projects",
  ships: "groups:modules.ships",
  contacts: "groups:modules.contacts",
  hr: "groups:modules.hr",
};
