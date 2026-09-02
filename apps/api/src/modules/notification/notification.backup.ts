import type { BackupContribution } from "@/modules/backup/registry";
import { webhookDeliveries, webhooks } from "./schema";

// Subscriptions restore before their delivery log so the
// `webhook_deliveries.webhook_id` foreign key resolves on insert. `created_by`
// is a soft reference, so the module has no cross-module deps. `secret` is a
// redacted field name in token exports (SECRET_FIELD_NAMES).
export const notificationBackupContribution: BackupContribution = {
  name: "notification",
  tables: [webhooks, webhookDeliveries],
  deps: [],
};
