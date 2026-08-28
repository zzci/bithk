import { registerBackupContribution } from "@/modules/backup/registry";
import { registerProjectSection } from "@/modules/project/section.registry";
import { shipBackupContribution } from "./ship.backup";
import { hasProjectEquipment } from "./ship.equipment.service";
import { hasShipProfile, provisionShipProfileTx } from "./ship.profile.service";
import { hasProjectEquipmentCategories, seedEquipmentCategoriesTx } from "./ship.ship-equipment-category.service";
import { hasProjectWorklists } from "./ship.worklist.service";

export { shipRoutes } from "./ship.routes";

registerBackupContribution(shipBackupContribution);

// The three maritime sections (PLAN-108 §5), registered from their owning
// module's barrel as an import-time side effect (ADR-009) so the project module
// never imports the ship module. A project with `ship-profile` mounted IS a
// ship; there is no ship table and no project type column.
//
// Every `provision` hook is SYNCHRONOUS: bun:sqlite transactions are, so a hook
// that deferred a write past an `await` would land after COMMIT.
//
// No section declares new capabilities: the three keep today's gating (member
// to read, `project.manage` to write), so the fold needs no role migration.

registerProjectSection({
  key: "ship-profile",
  // The profile row carries the vessel particulars. The `sectionData` slice is
  // validated inside the ship module — the project module hands it through
  // untyped and never learns its shape.
  provision: (tx, projectId, ctx) => {
    provisionShipProfileTx(tx, projectId, ctx.sectionData?.["ship-profile"], ctx.now);
  },
  hasData: hasShipProfile,
});

registerProjectSection({
  key: "equipment",
  // Copy-on-create: snapshot the global equipment-category template into this
  // project's own category set. Later global edits never touch this project.
  provision: (tx, projectId, ctx) => {
    seedEquipmentCategoriesTx(tx, projectId, ctx.now);
  },
  hasData: async (db, projectId) =>
    await hasProjectEquipment(db, projectId) || await hasProjectEquipmentCategories(db, projectId),
});

registerProjectSection({
  key: "worklist",
  // Nothing to seed: worklists start empty and are either authored in place or
  // copied one at a time from the global knowledge base.
  hasData: hasProjectWorklists,
});
