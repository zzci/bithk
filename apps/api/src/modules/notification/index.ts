// Notification module (FEAT-059 / FEAT-060): SMTP email delivery and webhook
// subscriptions, both fed by the audit event stream. The SMTP settings are
// plain `smtp.*` rows in the settings table; this module owns the mail
// transport, the admin test send, the consumers that turn audit events into
// mail, and the webhook tables + dispatcher.
import { registerBackupContribution } from "@/modules/backup/registry";
import { stopNotificationConsumers } from "./consumers";
import { stopMailQueue } from "./mail.queue";
import { notificationBackupContribution } from "./notification.backup";
import { stopWebhookDispatcher } from "./webhook.dispatcher";

export { startNotificationConsumers } from "./consumers";
export { notificationRoutes } from "./notification.routes";
export { startWebhookDispatcher } from "./webhook.dispatcher";

registerBackupContribution(notificationBackupContribution);

/** Shutdown hook: unsubscribe from the audit stream, stop retries, drain in-flight work. */
export async function stopNotifications(): Promise<void> {
  stopNotificationConsumers();
  await stopWebhookDispatcher();
  await stopMailQueue();
}
