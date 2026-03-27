/**
 * F1 Race Notification Service
 * Runs a check every 15 minutes; sends Discord + email for day-before, day-of, and 1-hour-before session reminders.
 */

import cron from "node-cron";
import { getPendingNotifications, markAsSent } from "./scheduler.js";
import { sendDiscordNotification, isDiscordConfigured } from "./notifiers/discord.js";
import { sendEmailNotification, isEmailConfigured } from "./notifiers/email.js";
import type { PendingNotification } from "./types.js";
import {
  isDiscordBotConfigured,
  sendDiscordWatchNotification,
  startDiscordBot,
} from "./discordBot.js";
import { buildStartupTestNotifications } from "./testNotification.js";

const CRON_SCHEDULE = "*/15 * * * *"; // every 15 minutes
const SEND_TEST_NOTIFICATION_ON_START = process.env.SEND_TEST_NOTIFICATION_ON_START === "1";

async function sendNotifications(
  pending: PendingNotification[],
  options?: { markSent: boolean }
): Promise<void> {
  if (pending.length === 0) return;

  const sentKeys: string[] = [];
  const discordConfigured = isDiscordConfigured();
  const emailConfigured = isEmailConfigured();
  const discordBotConfigured = isDiscordBotConfigured();

  for (const n of pending) {
    try {
      if (n.channel === "discord") {
        if (n.trigger === "watch_one_hour_before") {
          if (!discordBotConfigured) continue;
          await sendDiscordWatchNotification(n);
          sentKeys.push(n.key);
        } else {
          if (!discordConfigured) continue;
          await sendDiscordNotification(n);
          sentKeys.push(n.key);
        }
      } else if (n.channel === "email") {
        if (!emailConfigured) continue;
        await sendEmailNotification(n);
        sentKeys.push(n.key);
      } else {
        // Exhaustiveness guard (should be impossible).
        const _exhaustive: never = n.channel;
        void _exhaustive;
      }
    } catch (err) {
      console.error(`Failed to send ${n.channel} notification ${n.key}:`, err);
      // Don't mark as sent so we retry next run
    }
  }

  if (options?.markSent !== false && sentKeys.length > 0) {
    await markAsSent(sentKeys);
    console.log(`Sent ${sentKeys.length} notification(s): ${sentKeys.join(", ")}`);
  } else if (options?.markSent === false && sentKeys.length > 0) {
    console.log(`Sent ${sentKeys.length} startup test notification(s): ${sentKeys.join(", ")}`);
  }
}

async function runCheck(): Promise<void> {
  try {
    const pending = await getPendingNotifications();
    await sendNotifications(pending, { markSent: true });
  } catch (err) {
    console.error("Notification check failed:", err);
  }
}

async function main(): Promise<void> {
  console.log("F1 Race Notification Service starting");
  console.log("Discord:", isDiscordConfigured() ? "configured" : "not configured");
  console.log(
    "Discord bot:",
    isDiscordBotConfigured() ? "configured" : "not configured (watch-time replies disabled)"
  );
  console.log("Email:", isEmailConfigured() ? "configured" : "not configured");

  if (isDiscordBotConfigured()) {
    await startDiscordBot();
  }

  if (SEND_TEST_NOTIFICATION_ON_START) {
    console.log("SEND_TEST_NOTIFICATION_ON_START=1; sending startup test notifications");
    await sendNotifications(buildStartupTestNotifications(), { markSent: false });
  }

  cron.schedule(CRON_SCHEDULE, runCheck);

  await runCheck();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
