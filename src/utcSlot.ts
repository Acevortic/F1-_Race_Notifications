/**
 * Parse f1api.dev session date + time as a UTC instant.
 * Times without an explicit offset are treated as UTC (append Z).
 */

function ensureUtcOffset(timeStr: string): string {
  const t = timeStr.trim();
  if (/Z$/i.test(t) || /[+-]\d{2}:?\d{2}$/.test(t)) return t;
  return `${t}Z`;
}

export function parseUtcSlot(dateStr: string | null, timeStr: string | null): Date | null {
  if (!dateStr || !timeStr) return null;
  const iso = `${dateStr}T${ensureUtcOffset(timeStr)}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
