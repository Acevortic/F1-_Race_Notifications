/**
 * Core scheduler: compute notification windows (day-before, day-of, 1-hour-before),
 * check triggers, and handle dedup with sent.json.
 */

import { format, addHours, addMinutes, subDays } from "date-fns";
import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getSeasonSchedule, getSeasonYear } from "./api.js";
import type {
  ApiRace,
  NormalizedSession,
  PendingNotification,
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

const SESSION_TYPES: { key: keyof ApiRace["schedule"]; type: SessionType }[] = [
  { key: "qualy", type: "qualy" },
  { key: "race", type: "race" },
  { key: "sprintQualy", type: "sprintQualy" },
  { key: "sprintRace", type: "sprintRace" },
];

function parseUtcSlot(dateStr: string | null, timeStr: string | null): Date | null {
  if (!dateStr || !timeStr) return null;
  const iso = `${dateStr}T${timeStr}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
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
    startLocal,
    startLocalFormatted: toLocalFormatted(startUtc),
    circuitName: race.circuit.circuitName,
    circuitCity: race.circuit.city,
    country: race.circuit.country,
  };
}

function notificationKey(raceId: string, sessionType: SessionType, trigger: NotificationTrigger): string {
  return `${raceId}_${sessionType}_${trigger}`;
}

/** 9:00 AM in TIMEZONE on the calendar day (session day + dayOffset). dayOffset 0 = day of session, -1 = day before. Returns UTC Date. */
function dayReminderTimeUtc(sessionStartLocal: Date, dayOffset: number): Date {
  const dateStr = formatInTimeZone(sessionStartLocal, TIMEZONE, "yyyy-MM-dd");
  const [y, m, d] = dateStr.split("-").map(Number);
  const sessionDay = new Date(y, m - 1, d);
  const target = subDays(sessionDay, -dayOffset);
  const nineAm = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
    DAY_REMINDER_HOUR,
    0,
    0
  );
  return fromZonedTime(nineAm, TIMEZONE);
}

/**
 * Determine which notifications should fire now.
 * A trigger fires if: now is within [triggerTime, triggerTime + CHECK_WINDOW_MINUTES) and not already sent.
 */
export async function getPendingNotifications(): Promise<PendingNotification[]> {
  const races = await getSeasonSchedule();
  const season = getSeasonYear();
  const sentSet = await loadSentKeys();
  const now = new Date();

  const pending: PendingNotification[] = [];

  for (const race of races) {
    for (const { key: scheduleKey, type: sessionType } of SESSION_TYPES) {
      const session = normalizeSession(race, season, sessionType);
      if (!session) continue;

      const dayBeforeTrigger = dayReminderTimeUtc(session.startLocal, -1);
      const dayOfTrigger = dayReminderTimeUtc(session.startLocal, 0);
      const oneHourBeforeTrigger = addHours(session.startLocal, -1);

      const triggers: { trigger: NotificationTrigger; triggerTime: Date }[] = [
        { trigger: "day_before", triggerTime: dayBeforeTrigger },
        { trigger: "day_of", triggerTime: dayOfTrigger },
        { trigger: "one_hour_before", triggerTime: oneHourBeforeTrigger },
      ];

      for (const { trigger, triggerTime } of triggers) {
        const key = notificationKey(race.raceId, sessionType, trigger);
        if (sentSet.has(key)) continue;
        const windowEnd = addMinutes(triggerTime, CHECK_WINDOW_MINUTES);
        if (now < triggerTime) continue;
        if (now >= windowEnd) continue;
        pending.push({ key, session, trigger });
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
