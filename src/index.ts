/**
 * F1 Race Notification Service
 * Runs a check every 15 minutes; sends Discord + email for day-before, day-of, and 1-hour-before session reminders.
 */

import cron from "node-cron";
import { getPendingNotifications, markAsSent } from "./scheduler.js";
import { sendDiscordNotification, isDiscordConfigured } from "./notifiers/discord.js";
import { sendEmailNotification, isEmailConfigured } from "./notifiers/email.js";

const CRON_SCHEDULE = "*/15 * * * *"; // every 15 minutes

async function runCheck(): Promise<void> {
  try {
    const pending = await getPendingNotifications();
    if (pending.length === 0) return;

    const sentKeys: string[] = [];

    for (const n of pending) {
      try {
        if (isDiscordConfigured()) {
          await sendDiscordNotification(n);
        }
        if (isEmailConfigured()) {
          await sendEmailNotification(n);
        }
        sentKeys.push(n.key);
      } catch (err) {
        console.error(`Failed to send notification ${n.key}:`, err);
        // Don't mark as sent so we retry next run
      }
    }

    if (sentKeys.length > 0) {
      await markAsSent(sentKeys);
      console.log(`Sent ${sentKeys.length} notification(s): ${sentKeys.join(", ")}`);
    }
  } catch (err) {
    console.error("Notification check failed:", err);
  }
}

async function main(): Promise<void> {
  console.log("F1 Race Notification Service starting");
  console.log("Discord:", isDiscordConfigured() ? "configured" : "not configured");
  console.log("Email:", isEmailConfigured() ? "configured" : "not configured");

  cron.schedule(CRON_SCHEDULE, runCheck);

  await runCheck();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
