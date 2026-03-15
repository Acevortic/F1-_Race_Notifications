/**
 * Types for f1api.dev API responses and internal notification models.
 */

/** Session date/time from API (UTC). date is YYYY-MM-DD, time is HH:mm:ssZ or null */
export interface ApiSessionSlot {
  date: string | null;
  time: string | null;
}

/** Schedule for one race weekend */
export interface ApiSchedule {
  race: ApiSessionSlot;
  qualy: ApiSessionSlot;
  fp1: ApiSessionSlot;
  fp2: ApiSessionSlot;
  fp3: ApiSessionSlot;
  sprintQualy: ApiSessionSlot;
  sprintRace: ApiSessionSlot;
}

/** Circuit from API */
export interface ApiCircuit {
  circuitId: string;
  circuitName: string;
  country: string;
  city: string;
  circuitLength: string;
  lapRecord: string | null;
  firstParticipationYear: number;
  corners: number;
  url: string;
}

/** Single race from API (season schedule uses `races`, current/next uses `race`) */
export interface ApiRace {
  raceId: string;
  championshipId: string;
  raceName: string | null;
  schedule: ApiSchedule;
  laps: number | null;
  round: number;
  url: string | null;
  circuit: ApiCircuit;
}

/** Full season response: GET /api/{year} */
export interface ApiSeasonResponse {
  api: string;
  url: string;
  limit: number;
  offset: number;
  total: number;
  season: number;
  championship: { championshipId: string; championshipName: string; url: string; year: number };
  races: ApiRace[];
}

/** Current/next race response: GET /api/current/next */
export interface ApiCurrentNextResponse {
  api: string;
  url: string;
  total: number;
  season: number;
  championship: { championshipId: string; championshipName: string; url: string; year: number };
  race: ApiRace[];
}

/** Session type for notifications (qualifying, race, sprint qualifying, sprint race) */
export type SessionType = "qualy" | "race" | "sprintQualy" | "sprintRace";

/** Notification trigger type */
export type NotificationTrigger = "day_before" | "day_of" | "one_hour_before" | "next_race_after";

/** Normalized session with start time in local (CST) for scheduling */
export interface NormalizedSession {
  raceId: string;
  raceName: string;
  round: number;
  season: number;
  sessionType: SessionType;
  /** Session start time in local timezone (Date object, for comparison) */
  startLocal: Date;
  /** Formatted time string in local (e.g. "1:00 AM CST") */
  startLocalFormatted: string;
  circuitName: string;
  circuitCity: string;
  country: string;
}

/** One notification to send: session + trigger */
export interface PendingNotification {
  key: string;
  session: NormalizedSession;
  trigger: NotificationTrigger;
}

/** Persisted sent-notification record (for dedup) */
export interface SentRecord {
  key: string;
  sentAt: string; // ISO
}

/** Stored sent notifications (data/sent.json) */
export interface SentStore {
  records: SentRecord[];
}
