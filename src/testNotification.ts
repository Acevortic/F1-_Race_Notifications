import type { PendingNotification } from "./types.js";

function buildTestSession() {
  const now = new Date();
  return {
    raceId: "test_race",
    raceName: "F1 Test Alert",
    round: 0,
    season: now.getFullYear(),
    sessionType: "race" as const,
    startLocal: now,
    startLocalFormatted: now.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    circuitName: "Test Circuit",
    circuitCity: "Test City",
    country: "United States",
  };
}

export function buildStartupTestNotifications(): PendingNotification[] {
  const session = buildTestSession();
  const id = Date.now();
  const baseKey = `teststartup${id}_race_day_of`;
  return [
    {
      key: `${baseKey}_discord`,
      channel: "discord",
      session,
      trigger: "day_of",
    },
    {
      key: `${baseKey}_email`,
      channel: "email",
      session,
      trigger: "day_of",
    },
  ];
}

