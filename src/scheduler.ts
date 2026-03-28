/**
 * Core scheduler: compute notification windows (day-before, day-of, 1-hour-before),
 * check triggers, and handle dedup with sent.json.
 */

import { format, addHours, addMinutes } from "date-fns";
import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getSeasonSchedule, getSeasonYear } from "./api.js";
import { parseUtcSlot } from "./utcSlot.js";
import { loadWatchRecords } from "./watchStore.js";
import type {
  ApiRace,
  NormalizedSession,
  PendingNotification,
  NotificationChannel,
  NotificationTrigger,
  SentRecord,
  SentStore,
} from "./types.js";
import type { SessionType } from "./types.js";

const TIMEZONE = process.env.TIMEZONE ?? "America/Chicago";
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const SENT_FILE = join(DATA_DIR, "sent.json");
const CHECK_WINDOW_MINUTES = 15;
const DAY_REMINDER_HOUR = 9;
const PRUNE_DAYS = 7;
const RACE_END_OFFSET_HOURS = 2;
const NEXT_RACE_ANNOUNCE_DELAY_HOURS = 1;
const DEBUG_SCHEDULER = process.env.DEBUG_SCHEDULER === "1";

const SESSION_TYPES: { key: keyof ApiRace["schedule"]; type: SessionType }[] = [
  { key: "qualy", type: "qualy" },
  { key: "race", type: "race" },
  { key: "sprintQualy", type: "sprintQualy" },
  { key: "sprintRace", type: "sprintRace" },
];

const CHANNELS: NotificationChannel[] = ["discord", "email"];

/** Shift a calendar yyyy-MM-dd by delta days using UTC date math (Gregorian). */
function addCalendarDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const shifted = new Date(base + deltaDays * 86400000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function toLocalFormatted(utcDate: Date): string {
  const zoned = toZonedTime(utcDate, TIMEZONE);
  const abbrev = new Intl.DateTimeFormat("en", { timeZone: TIMEZONE, timeZoneName: "short" })
    .formatToParts(zoned)
    .find((p) => p.type === "timeZoneName")?.value ?? "local";
  return `${format(zoned, "h:mm a")} ${abbrev}`;
}

function normalizeSession(
  race: ApiRace,
  season: number,
  sessionType: SessionType
): NormalizedSession | null {
  const schedule = race.schedule;
  const slot = schedule[sessionType];
  const startUtc = parseUtcSlot(slot.date, slot.time);
  if (!startUtc) return null;

  const startLocal = toZonedTime(startUtc, TIMEZONE);
  const raceName = race.raceName ?? race.circuit.circuitName;

  return {
    raceId: race.raceId,
    raceName,
    round: race.round,
    season,
    sessionType,
    startUtc,
    startLocal,
    startLocalFormatted: toLocalFormatted(startUtc),
    circuitName: race.circuit.circuitName,
    circuitCity: race.circuit.city,
    country: race.circuit.country,
  };
}

function baseNotificationKey(raceId: string, sessionType: SessionType, trigger: NotificationTrigger): string {
  return `${raceId}_${sessionType}_${trigger}`;
}

/**
 * 9:00 AM in TIMEZONE on a calendar day relative to the session’s date in TIMEZONE.
 * `daysBackFromSessionDay`: 0 = same calendar day as session; 1 = one calendar day before session day.
 * Returns UTC instant for that local 9am (server TZ-independent).
 */
function dayReminderTimeUtc(sessionStartUtc: Date, daysBackFromSessionDay: number): Date {
  const sessionYmd = formatInTimeZone(sessionStartUtc, TIMEZONE, "yyyy-MM-dd");
  const targetYmd = addCalendarDaysToYmd(sessionYmd, -daysBackFromSessionDay);
  const hh = String(DAY_REMINDER_HOUR).padStart(2, "0");
  return fromZonedTime(`${targetYmd}T${hh}:00:00`, TIMEZONE);
}

/**
 * Determine which notifications should fire now.
 * A trigger fires if: now is within [triggerTime, triggerTime + CHECK_WINDOW_MINUTES) and not already sent.
 */
function getRaceStartUtc(race: ApiRace): Date | null {
  const slot = race.schedule.race;
  return parseUtcSlot(slot.date, slot.time);
}

export async function getPendingNotifications(): Promise<PendingNotification[]> {
  const races = await getSeasonSchedule();
  const season = getSeasonYear();
  const sentSet = await loadSentKeys();
  const now = new Date();

  const pending: PendingNotification[] = [];

  const racesByRound = [...races].sort((a, b) => a.round - b.round);
  const raceById = new Map(racesByRound.map((r) => [r.raceId, r]));

  if (DEBUG_SCHEDULER) {
    const nowLocal = formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd HH:mm:ss zzz");
    console.log(`[DEBUG_SCHEDULER] TIMEZONE=${TIMEZONE} now=${nowLocal}`);
    const japanRace =
      racesByRound.find(
        (r) =>
          r.circuit.country === "Japan" ||
          (r.raceName?.toLowerCase().includes("japan") ?? false) ||
          r.raceId.toLowerCase().includes("japan")
      ) ?? racesByRound[0];
    if (japanRace) {
      for (const st of ["qualy", "race"] as const) {
        const session = normalizeSession(japanRace, season, st);
        if (!session) continue;
        const dayBeforeTrigger = dayReminderTimeUtc(session.startUtc, 1);
        const dayOfTrigger = dayReminderTimeUtc(session.startUtc, 0);
        console.log(
          `[DEBUG_SCHEDULER] ${japanRace.raceId} ${st} startLocalFormatted=${session.startLocalFormatted} ` +
            `day_before_9am=${formatInTimeZone(dayBeforeTrigger, TIMEZONE, "yyyy-MM-dd HH:mm")} ` +
            `day_of_9am=${formatInTimeZone(dayOfTrigger, TIMEZONE, "yyyy-MM-dd HH:mm")}`
        );
      }
    }
  }

  for (const race of racesByRound) {
    for (const { key: scheduleKey, type: sessionType } of SESSION_TYPES) {
      const session = normalizeSession(race, season, sessionType);
      if (!session) continue;

      const dayBeforeTrigger = dayReminderTimeUtc(session.startUtc, 1);
      const dayOfTrigger = dayReminderTimeUtc(session.startUtc, 0);
      const oneHourBeforeTrigger = addHours(session.startUtc, -1);

      const triggers: { trigger: NotificationTrigger; triggerTime: Date }[] = [
        { trigger: "day_before", triggerTime: dayBeforeTrigger },
        { trigger: "day_of", triggerTime: dayOfTrigger },
        { trigger: "one_hour_before", triggerTime: oneHourBeforeTrigger },
      ];

      for (const { trigger, triggerTime } of triggers) {
        const windowEnd = addMinutes(triggerTime, CHECK_WINDOW_MINUTES);
        if (now < triggerTime) continue;
        if (now >= windowEnd) continue;

        const baseKey = baseNotificationKey(race.raceId, sessionType, trigger);
        for (const channel of CHANNELS) {
          const key = `${baseKey}_${channel}`;
          if (sentSet.has(key)) continue;
          pending.push({ key, channel, session, trigger });
        }
      }
    }
  }

  // User watch-time reminders (saved from Discord replies).
  const watchRecords = await loadWatchRecords();
  for (const wr of watchRecords) {
    const watchStartUtc = new Date(wr.watchStartUtcIso);
    const triggerTime = addHours(watchStartUtc, -1);
    if (now < triggerTime) continue;

    const windowEnd = addMinutes(triggerTime, CHECK_WINDOW_MINUTES);
    if (now >= windowEnd) continue;

    const race = raceById.get(wr.raceId);
    if (!race) continue;

    const raceName = race.raceName ?? race.circuit.circuitName;
    const session: NormalizedSession = {
      raceId: wr.raceId,
      raceName,
      round: race.round,
      season,
      sessionType: wr.sessionType,
      startUtc: watchStartUtc,
      startLocal: toZonedTime(watchStartUtc, TIMEZONE),
      startLocalFormatted: toLocalFormatted(watchStartUtc),
      circuitName: race.circuit.circuitName,
      circuitCity: race.circuit.city,
      country: race.circuit.country,
    };

    const baseKey = `watch_${wr.id}_watch_one_hour_before`;
    for (const channel of CHANNELS) {
      const key = `${baseKey}_${channel}`;
      if (sentSet.has(key)) continue;
      pending.push({
        key,
        channel,
        session,
        trigger: "watch_one_hour_before",
        discordTarget:
          channel === "discord"
            ? { channelId: wr.channelId, userId: wr.userId }
            : undefined,
      });
    }
  }

  // Next-race-after: send once when we're in the window [raceEnd+1h, raceEnd+1h+15min) after the last finished race
  let lastFinishedRace: ApiRace | null = null;
  for (let i = racesByRound.length - 1; i >= 0; i--) {
    const r = racesByRound[i];
    const raceStartUtc = getRaceStartUtc(r);
    if (!raceStartUtc) continue;
    const raceEndUtc = addHours(raceStartUtc, RACE_END_OFFSET_HOURS);
    if (raceEndUtc < now) {
      lastFinishedRace = r;
      break;
    }
  }
  let nextRace: ApiRace | null = null;
  for (const r of racesByRound) {
    const raceStartUtc = getRaceStartUtc(r);
    if (!raceStartUtc) continue;
    if (raceStartUtc > now) {
      nextRace = r;
      break;
    }
  }
  if (lastFinishedRace && nextRace) {
    const lastRaceStartUtc = getRaceStartUtc(lastFinishedRace)!;
    const lastRaceEndUtc = addHours(lastRaceStartUtc, RACE_END_OFFSET_HOURS);
    const triggerTime = addHours(lastRaceEndUtc, NEXT_RACE_ANNOUNCE_DELAY_HOURS);
    const windowEnd = addMinutes(triggerTime, CHECK_WINDOW_MINUTES);
    if (now >= triggerTime && now < windowEnd) {
      const nextSession = normalizeSession(nextRace, season, "race");
      if (nextSession) {
        const baseKey = `next_race_after_${lastFinishedRace.raceId}`;
        for (const channel of CHANNELS) {
          const key = `${baseKey}_${channel}`;
          if (sentSet.has(key)) continue;
          pending.push({ key, channel, session: nextSession, trigger: "next_race_after" });
        }
      }
    }
  }

  return pending;
}

async function loadSentKeys(): Promise<Set<string>> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const raw = await readFile(SENT_FILE, "utf-8");
    const store = JSON.parse(raw) as SentStore;
    const pruneCutoff = new Date();
    pruneCutoff.setDate(pruneCutoff.getDate() - PRUNE_DAYS);
    const kept = (store.records ?? []).filter((r) => new Date(r.sentAt) >= pruneCutoff);
    return new Set(kept.map((r) => r.key));
  } catch {
    return new Set();
  }
}

async function loadSentStore(): Promise<SentStore> {
  try {
    const raw = await readFile(SENT_FILE, "utf-8");
    const store = JSON.parse(raw) as SentStore;
    const pruneCutoff = new Date();
    pruneCutoff.setDate(pruneCutoff.getDate() - PRUNE_DAYS);
    const kept = (store.records ?? []).filter((r) => new Date(r.sentAt) >= pruneCutoff);
    return { records: kept };
  } catch {
    return { records: [] };
  }
}

/** Mark notifications as sent and persist to sent.json */
export async function markAsSent(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await mkdir(DATA_DIR, { recursive: true });
  const store = await loadSentStore();
  const now = new Date().toISOString();
  for (const key of keys) {
    store.records.push({ key, sentAt: now });
  }
  await writeFile(SENT_FILE, JSON.stringify(store, null, 2), "utf-8");
}
