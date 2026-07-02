import { registerBackupContribution } from "@/modules/backup/registry";
import { registerSearchSource } from "@/modules/search/search.registry";
import { shipBackupContribution } from "./ship.backup";
import { registerShipCoverPermissionHook } from "./ship.cover.permission";
import { listShips } from "./ship.service";

export { shipRoutes } from "./ship.routes";

registerBackupContribution(shipBackupContribution);
registerShipCoverPermissionHook();

registerSearchSource({
  key: "ships",
  module: "ships",
  search: async ({ db, userId, isAdmin, limit }, q) => {
    const result = await listShips(db, { q, limit, memberUserId: isAdmin ? undefined : userId });
    return result.data.map(s => ({ type: "ship" as const, id: s.id, title: s.name, subtitle: s.code }));
  },
});
