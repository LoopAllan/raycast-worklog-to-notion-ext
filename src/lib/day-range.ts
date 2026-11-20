export interface DayRange {
  start: string;
  end: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatOffset(timezoneOffsetMinutes: number): string {
  const sign = timezoneOffsetMinutes <= 0 ? "+" : "-";
  const absolute = Math.abs(timezoneOffsetMinutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/**
 * Local-midnight bounds of the day containing `now`, as ISO strings with an
 * explicit offset so Notion's date filter does not fall back to UTC days.
 * `timezoneOffsetMinutes` follows Date#getTimezoneOffset (UTC+8 is -480).
 */
export function localDayRange(now: Date, timezoneOffsetMinutes: number = now.getTimezoneOffset()): DayRange {
  const local = new Date(now.getTime() - timezoneOffsetMinutes * 60_000);
  const startUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const nextUtc = new Date(startUtc + 24 * 60 * 60_000);
  const offset = formatOffset(timezoneOffsetMinutes);
  const toIso = (date: Date) =>
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T00:00:00${offset}`;

  return { start: toIso(new Date(startUtc)), end: toIso(nextUtc) };
}
