/**
 * F1 API client - fetches and caches the full season schedule from f1api.dev.
 * Cache is refreshed once per day.
 */

import type { ApiSeasonResponse, ApiRace } from "./types.js";

const BASE_URL = "https://f1api.dev/api";

let cached: { season: number; races: ApiRace[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get the current season year (e.g. 2026). Uses env F1_SEASON if set, else current calendar year.
 */
export function getSeasonYear(): number {
  const env = process.env.F1_SEASON;
  if (env) {
    const n = parseInt(env, 10);
    if (!Number.isNaN(n)) return n;
  }
  return new Date().getFullYear();
}

/**
 * Fetch full season schedule from f1api.dev. Returns cached data if still fresh.
 */
export async function getSeasonSchedule(): Promise<ApiRace[]> {
  const now = Date.now();
  const season = getSeasonYear();

  if (cached && cached.season === season && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.races;
  }

  const url = `${BASE_URL}/${season}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`F1 API error: ${res.status} ${res.statusText} for ${url}`);
  }

  const data = (await res.json()) as ApiSeasonResponse;

  if (!data.races || !Array.isArray(data.races)) {
    throw new Error("F1 API returned invalid schedule");
  }

  cached = { season, races: data.races, fetchedAt: now };
  return data.races;
}

/**
 * Force refresh the cache (e.g. on startup if you want fresh data immediately).
 */
export function clearScheduleCache(): void {
  cached = null;
}
