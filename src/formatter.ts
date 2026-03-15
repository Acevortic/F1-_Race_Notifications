/**
 * Format notification content for Discord embeds, email HTML, and plain text.
 */

import type { NormalizedSession, NotificationTrigger, PendingNotification } from "./types.js";

const SESSION_LABELS: Record<string, string> = {
  qualy: "Qualifying",
  race: "Race",
  sprintQualy: "Sprint Qualifying",
  sprintRace: "Sprint Race",
};

/** Discord embed color (decimal). Green, yellow, red for day_before, day_of, one_hour_before */
const TRIGGER_COLORS: Record<NotificationTrigger, number> = {
  day_before: 0x22c55e,
  day_of: 0xeab308,
  one_hour_before: 0xef4444,
};

/** Country name to flag emoji (common F1 host countries) */
const COUNTRY_FLAGS: Record<string, string> = {
  Australia: "🇦🇺",
  Azerbaijan: "🇦🇿",
  Bahrain: "🇧🇭",
  Belgium: "🇧🇪",
  Brazil: "🇧🇷",
  Canada: "🇨🇦",
  China: "🇨🇳",
  "Great Britain": "🇬🇧",
  Hungary: "🇭🇺",
  Italy: "🇮🇹",
  Japan: "🇯🇵",
  Mexico: "🇲🇽",
  Monaco: "🇲🇨",
  Netherlands: "🇳🇱",
  Qatar: "🇶🇦",
  "Saudi Arabia": "🇸🇦",
  Singapore: "🇸🇬",
  Spain: "🇪🇸",
  "United Arab Emirates": "🇦🇪",
  "United States": "🇺🇸",
  Austria: "🇦🇹",
};

function getFlag(country: string): string {
  return COUNTRY_FLAGS[country] ?? "🏁";
}

function sessionLabel(sessionType: string): string {
  return SESSION_LABELS[sessionType] ?? sessionType;
}

export function plainText(n: PendingNotification): string {
  const s = n.session;
  const label = sessionLabel(s.sessionType);
  switch (n.trigger) {
    case "day_before":
      return `${s.raceName} ${label} is tomorrow at ${s.startLocalFormatted}`;
    case "day_of":
      return `${s.raceName} ${label} is today at ${s.startLocalFormatted}`;
    case "one_hour_before":
      return `${s.raceName} ${label} starts in 1 hour!`;
    default:
      return `${s.raceName} ${label} at ${s.startLocalFormatted}`;
  }
}

export interface DiscordEmbedPayload {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
}

export function discordEmbed(n: PendingNotification): DiscordEmbedPayload {
  const s = n.session;
  const label = sessionLabel(s.sessionType);
  const flag = getFlag(s.country);

  let title: string;
  switch (n.trigger) {
    case "day_before":
      title = `${flag} ${s.raceName} – ${label} tomorrow`;
      break;
    case "day_of":
      title = `${flag} ${s.raceName} – ${label} today`;
      break;
    case "one_hour_before":
      title = `${flag} ${s.raceName} – ${label} in 1 hour!`;
      break;
    default:
      title = `${flag} ${s.raceName} – ${label}`;
  }

  const description =
    n.trigger === "one_hour_before"
      ? `Starts at **${s.startLocalFormatted}**`
      : `Session starts at **${s.startLocalFormatted}**`;

  return {
    title,
    description,
    color: TRIGGER_COLORS[n.trigger],
    fields: [
      { name: "Circuit", value: `${s.circuitName}, ${s.circuitCity}`, inline: true },
      { name: "Session", value: label, inline: true },
    ],
  };
}

export function emailHtml(n: PendingNotification): string {
  const s = n.session;
  const label = sessionLabel(s.sessionType);
  const flag = getFlag(s.country);
  const plain = plainText(n);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>F1 Reminder</title>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <h1 style="font-size: 1.25rem; margin-bottom: 8px;">${flag} ${s.raceName}</h1>
  <p style="font-size: 1rem; margin: 0 0 8px 0; color: #333;">${label}</p>
  <p style="font-size: 1.125rem; font-weight: 600; margin: 0 0 16px 0;">${s.startLocalFormatted}</p>
  <p style="font-size: 0.875rem; color: #666;">${s.circuitName}, ${s.circuitCity}</p>
  <p style="font-size: 0.875rem; color: #888; margin-top: 24px;">${plain}</p>
</body>
</html>
`.trim();
}

export function emailSubject(n: PendingNotification): string {
  const s = n.session;
  const label = sessionLabel(s.sessionType);
  switch (n.trigger) {
    case "day_before":
      return `F1 Reminder: ${s.raceName} ${label} tomorrow at ${s.startLocalFormatted}`;
    case "day_of":
      return `F1 Reminder: ${s.raceName} ${label} today at ${s.startLocalFormatted}`;
    case "one_hour_before":
      return `F1: ${s.raceName} ${label} starts in 1 hour!`;
    default:
      return `F1 Reminder: ${s.raceName} ${label}`;
  }
}
