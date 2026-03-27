import { Client, GatewayIntentBits, Partials, EmbedBuilder, type Message } from "discord.js";
import { formatInTimeZone } from "date-fns-tz";
import { fromZonedTime } from "date-fns-tz";
import { getSeasonSchedule, getSeasonYear } from "./api.js";
import { upsertWatchRecord } from "./watchStore.js";
import type { PendingNotification, SessionType } from "./types.js";
import { discordEmbed } from "./formatter.js";

const TIMEZONE = process.env.TIMEZONE ?? "America/Chicago";
const DEBUG_DISCORD_BOT = process.env.DEBUG_DISCORD_BOT === "1";

const SESSION_LABELS: Record<SessionType, string> = {
  qualy: "Qualifying",
  race: "Race",
  sprintQualy: "Sprint Qualifying",
  sprintRace: "Sprint Race",
};

let client: Client | null = null;
let ready = false;

function parseUtcSlot(dateStr: string | null, timeStr: string | null): Date | null {
  if (!dateStr || !timeStr) return null;
  const iso = `${dateStr}T${timeStr}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getTimeZoneAbbrev(date: Date): string {
  return (
    new Intl.DateTimeFormat("en", { timeZone: TIMEZONE, timeZoneName: "short" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value ?? "local"
  );
}

function getFooterText(repliedMessage: Message): string | undefined {
  const embeds = (repliedMessage.embeds ?? []) as unknown as Array<{ footer?: { text?: string } }>;
  for (const emb of embeds) {
    const txt = emb.footer?.text;
    if (typeof txt === "string" && txt.trim().length > 0) return txt;
  }
  return undefined;
}

function parseReminderKeyFromFooter(
  footerText: string
): { raceId: string; sessionType: SessionType } | null {
  // PendingNotification.key is channel-specific: `${raceId}_${sessionType}_${trigger}_${channel}`
  const re =
    /^(?<raceId>.+)_(?<sessionType>qualy|race|sprintQualy|sprintRace)_(?<trigger>day_before|day_of|one_hour_before|next_race_after|watch_one_hour_before)_(?<channel>discord|email)$/;
  const m = footerText.trim().match(re);
  if (!m || !m.groups) return null;
  const raceId = m.groups.raceId as string;
  const sessionType = m.groups.sessionType as SessionType;
  return { raceId, sessionType };
}

function parseWatchTime(input: string): { hour24: number; minute: number } | null {
  // Time-only, e.g. "5:00 PM CDT"
  const m = input.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*(CDT|CST)\b/i);
  if (!m) return null;
  const rawHour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3].toUpperCase();

  if (Number.isNaN(rawHour) || Number.isNaN(minute)) return null;
  if (rawHour < 1 || rawHour > 12) return null;
  if (minute < 0 || minute > 59) return null;

  let hour24 = rawHour % 12;
  if (meridiem === "PM") hour24 += 12;
  return { hour24, minute };
}

export function isDiscordBotConfigured(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN);
}

export async function startDiscordBot(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  if (client && ready) return;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // Required to read message.content for parsing user-provided watch time.
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  const readyPromise = new Promise<void>((resolve) => {
    client?.once("clientReady", () => {
      ready = true;
      console.log("Discord bot ready");
      resolve();
    });
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    if (DEBUG_DISCORD_BOT) {
      console.log(
        `Discord messageCreate: guild=${message.guildId ?? "dm"} channel=${message.channelId} reference=${message.reference?.messageId ?? "none"}`
      );
    }

    if (message.content.trim().toLowerCase() === "!ping") {
      await message.reply("pong");
      return;
    }

    if (!message.reference?.messageId) return;

    // Fetch the message being replied to (so we can read its embed footer key).
    const replied =
      (await message.fetchReference().catch(() => null)) ??
      (await message.channel.messages.fetch(message.reference.messageId).catch(() => null));
    if (!replied) {
      console.warn("Discord reply ignored: could not fetch referenced message");
      await message.reply(
        "I couldn't read the message you replied to. Please reply directly to the reminder message."
      );
      return;
    }

    const footerText = getFooterText(replied);
    if (!footerText) {
      console.warn("Discord reply ignored: referenced message had no footer key");
      await message.reply(
        "That message is missing reminder metadata. Please reply to a newly sent reminder message."
      );
      return;
    }

    const parsed = parseReminderKeyFromFooter(footerText);
    if (!parsed) {
      console.warn(`Discord reply ignored: unrecognized footer key format: ${footerText}`);
      await message.reply(
        "I couldn't parse the reminder metadata. Please reply to a newly sent reminder message."
      );
      return;
    }

    const watchTime = parseWatchTime(message.content);
    if (!watchTime) {
      await message.reply(
        `Reply with a time like "5:00 PM CDT" (time-only) so I can schedule your reminder.`
      );
      return;
    }

    try {
      const races = await getSeasonSchedule();
      const season = getSeasonYear();
      const race = races.find((r) => r.raceId === parsed.raceId);
      if (!race) {
        await message.reply("Sorry, I couldn't find that race session in the schedule.");
        return;
      }

      const slot = race.schedule[parsed.sessionType];
      const sessionStartUtc = parseUtcSlot(slot.date, slot.time);
      if (!sessionStartUtc) {
        await message.reply("Sorry, I couldn't determine the session start time for that reply.");
        return;
      }

      // Infer the date from the referenced session's local calendar day.
      const dateStr = formatInTimeZone(sessionStartUtc, TIMEZONE, "yyyy-MM-dd");
      const [y, m, d] = dateStr.split("-").map(Number);
      const localWatch = new Date(y, m - 1, d, watchTime.hour24, watchTime.minute, 0);
      const watchStartUtc = fromZonedTime(localWatch, TIMEZONE);

      const watchStartUtcIso = watchStartUtc.toISOString();
      const id = `${message.author.id}_${parsed.raceId}_${parsed.sessionType}_${watchStartUtcIso}`;

      await upsertWatchRecord({
        id,
        raceId: parsed.raceId,
        sessionType: parsed.sessionType,
        watchStartUtcIso,
        channelId: message.channel.id,
        userId: message.author.id,
      });

      const localFormatted = `${formatInTimeZone(watchStartUtc, TIMEZONE, "h:mm a")} ${getTimeZoneAbbrev(
        watchStartUtc
      )}`;
      await message.reply(
        `Saved. I'll remind you 1 hour before ${SESSION_LABELS[parsed.sessionType]} at ${localFormatted}.`
      );
    } catch (err) {
      console.error("Failed to process watch-time reply:", err);
      await message.reply("Sorry, something went wrong while saving your watch time.");
    }
  });

  await client.login(token);
  await readyPromise;
}

function requireClient(): Client {
  if (!client || !ready) {
    throw new Error("Discord bot is not ready yet");
  }
  return client;
}

export async function sendDiscordWatchNotification(n: PendingNotification): Promise<void> {
  if (n.trigger !== "watch_one_hour_before") {
    throw new Error(`sendDiscordWatchNotification called for trigger ${n.trigger}`);
  }

  if (!n.discordTarget) {
    throw new Error("Missing discordTarget on watch notification");
  }

  const c = requireClient();
  const channel = await c.channels.fetch(n.discordTarget.channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Discord channel ${n.discordTarget.channelId} is not text-based`);
  }

  const embedPayload = discordEmbed(n);
  const embed = new EmbedBuilder()
    .setTitle(embedPayload.title)
    .setDescription(embedPayload.description)
    .setColor(embedPayload.color)
    .addFields(embedPayload.fields)
    .setFooter(embedPayload.footer ? { text: embedPayload.footer.text } : null);

  const content = n.discordTarget.userId ? `<@${n.discordTarget.userId}>` : undefined;
  await (channel as any).send({ content, embeds: [embed] });
}

