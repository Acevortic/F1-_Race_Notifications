import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { SessionType } from "./types.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const WATCH_FILE = join(DATA_DIR, "watch.json");
const PRUNE_DAYS = parseNumberEnv("WATCH_PRUNE_DAYS", 14, 1, 90);

function parseNumberEnv(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return defaultValue;
  return Math.min(max, Math.max(min, n));
}

export interface WatchRecord {
  id: string;
  raceId: string;
  sessionType: SessionType;
  /** Watch start time as an actual UTC instant (ISO string). */
  watchStartUtcIso: string;
  /** Where to message the user one hour before. */
  channelId: string;
  userId?: string;
  createdAt: string; // ISO
}

export interface WatchStore {
  records: WatchRecord[];
}

async function loadWatchStore(): Promise<WatchStore> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const raw = await readFile(WATCH_FILE, "utf-8");
    const store = JSON.parse(raw) as WatchStore;
    return { records: store.records ?? [] };
  } catch {
    return { records: [] };
  }
}

function pruneRecords(records: WatchRecord[]): WatchRecord[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PRUNE_DAYS);
  return records.filter((r) => new Date(r.watchStartUtcIso) >= cutoff);
}

export async function loadWatchRecords(): Promise<WatchRecord[]> {
  const store = await loadWatchStore();
  return pruneRecords(store.records ?? []);
}

export async function upsertWatchRecord(input: Omit<WatchRecord, "createdAt">): Promise<WatchRecord> {
  const store = await loadWatchStore();
  const records = pruneRecords(store.records ?? []);

  const nowIso = new Date().toISOString();
  const idx = records.findIndex((r) => r.id === input.id);
  if (idx >= 0) {
    records[idx] = {
      ...records[idx],
      ...input,
      createdAt: records[idx].createdAt ?? nowIso,
    };
  } else {
    records.push({ ...input, createdAt: nowIso });
  }

  await writeFile(WATCH_FILE, JSON.stringify({ records }, null, 2), "utf-8");
  return records.find((r) => r.id === input.id)!;
}

