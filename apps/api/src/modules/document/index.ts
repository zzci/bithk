import { registerBackupContribution } from "@/modules/backup/registry";
import { registerSearchSource } from "@/modules/search/search.registry";
import { documentBackupContribution } from "./document.backup";
import { listMyDocuments } from "./document.service";
// Side-effect import: registers the document share adapter with the share module.
import "./document.share-adapter";

// Side-effect import: registers the document resource with the policy
// framework. The `documentAccess` client is re-exported below so other
// modules can compose against the same vocabulary.
export { documentAccess } from "./document.permission";
export { documentRoutes } from "./document.routes";

registerBackupContribution(documentBackupContribution);

registerSearchSource({
  key: "documents",
  module: "documents",
  search: async ({ db, userId, limit }, q) => {
    const result = await listMyDocuments(db, { userId, q, limit });
    return result.data.map(d => ({ type: "document" as const, id: d.id, title: d.title }));
  },
});
