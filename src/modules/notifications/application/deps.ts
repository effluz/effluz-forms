import type { AlertSource } from "./ports/alert-source";
import type { DeliveryLog } from "./ports/delivery-log";
import type { EmailRenderer } from "./ports/email-renderer";
import type { EmailSender } from "./ports/email-sender";
import type { MessageSource } from "./ports/message-source";

export interface NotificationsDeps {
  sender: EmailSender;
  renderer: EmailRenderer;
  source: MessageSource;
  alerts: AlertSource;
  deliveries: DeliveryLog;
}
