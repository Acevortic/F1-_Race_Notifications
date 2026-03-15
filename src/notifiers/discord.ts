/**
 * Send notifications via Discord webhook (rich embeds).
 */

import type { PendingNotification } from "../types.js";
import { discordEmbed } from "../formatter.js";

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

export function isDiscordConfigured(): boolean {
  return Boolean(WEBHOOK_URL && WEBHOOK_URL.startsWith("https://discord.com/api/webhooks/"));
}

export async function sendDiscordNotification(n: PendingNotification): Promise<void> {
  if (!WEBHOOK_URL) {
    throw new Error("DISCORD_WEBHOOK_URL is not set");
  }

  const embed = discordEmbed(n);

  const body = {
    embeds: [
      {
        title: embed.title,
        description: embed.description,
        color: embed.color,
        fields: embed.fields,
      },
    ],
  };

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} ${text}`);
  }
}
