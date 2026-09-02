import { stopNotificationConsumers } from "./consumers";
// Notification module (FEAT-059/060): SMTP email delivery and (FEAT-060)
// webhook subscriptions, both fed by the audit event stream. The SMTP
// settings are plain `smtp.*` rows in the settings table; this module owns the
// transport, the admin test send, and the consumers that turn audit events
// into mail.
import { stopMailQueue } from "./mail.queue";

export { startNotificationConsumers } from "./consumers";
export { notificationRoutes } from "./notification.routes";

/** Shutdown hook: unsubscribe from the audit stream and drain the in-flight send. */
export async function stopNotifications(): Promise<void> {
  stopNotificationConsumers();
  await stopMailQueue();
}
