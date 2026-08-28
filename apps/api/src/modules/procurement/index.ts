import { registerBackupContribution } from "@/modules/backup/registry";
import { registerProjectSection } from "@/modules/project/section.registry";
import { procurementBackupContribution } from "./procurement.backup";
import { hasProjectCategories } from "./procurement.categories";
import { seedProjectCategoriesTx } from "./procurement.global-categories";
import { hasProjectProcurements } from "./procurement.service";

export { procurementRoutes } from "./procurement.routes";

registerBackupContribution(procurementBackupContribution);

// The `procurement` section (PLAN-108 §3), registered from its owning module's
// barrel as an import-time side effect (ADR-009). `categories.manage` belongs
// here too: procurement categories are procurement-domain data, which is why
// both category tables moved out of `project/schema.ts` into this module.
registerProjectSection({
  key: "procurement",
  capabilities: ["procurement.view", "procurement.comment", "procurement.manage", "categories.manage"],
  // Copy-on-create: snapshot the global category template into this project's
  // own category set. Later global edits never touch this project. SYNCHRONOUS
  // — bun:sqlite transactions are, so a write deferred past an `await` would
  // land after COMMIT. This is the copy that used to sit inside
  // `createProjectTx`.
  provision: (tx, projectId, ctx) => {
    seedProjectCategoriesTx(tx, projectId, ctx.now);
  },
  // Either half blocks an unmount: the categories outlive the procurements
  // they classify, so a project with only categories still holds data.
  hasData: async (db, projectId) =>
    await hasProjectProcurements(db, projectId) || await hasProjectCategories(db, projectId),
});
