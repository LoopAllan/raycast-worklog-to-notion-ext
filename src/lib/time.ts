const MINUTES_PER_DAY = 24 * 60;
const LAST_SLOT = MINUTES_PER_DAY - 5;
const TIME_PATTERN = /^(\d{1,2}):?(\d{2})$/;
const DURATION_STEP = 10;

/** Parses "mmii" / "mii" / "mm:ii" into minutes since midnight. */
export function parseHhmm(input: string): number {
  const match = TIME_PATTERN.exec(input.trim());
  if (!match) {
    throw new Error(`時間格式錯誤：「${input}」，請輸入 4 碼，例如 1110`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`時間超出範圍：「${input}」`);
  }
  return hours * 60 + minutes;
}

export function formatHhmm(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}`;
}

/** Capped at 23:55 so a late entry never wraps into the next day. */
export function roundToFiveMinutes(totalMinutes: number): number {
  return Math.min(Math.round(totalMinutes / 5) * 5, LAST_SLOT);
}

export function normalizeTime(input: string): string {
  return formatHhmm(roundToFiveMinutes(parseHhmm(input)));
}

export function currentTimeSlot(now: Date = new Date()): string {
  return formatHhmm(roundToFiveMinutes(now.getHours() * 60 + now.getMinutes()));
}

/** Rounds to the nearest 10 minutes (half up), never below 10. Empty input means the minimum. */
export function roundDuration(input: string): number {
  const trimmed = input.trim();
  if (trimmed === "") {
    return DURATION_STEP;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`耗時必須是正整數分鐘：「${input}」`);
  }
  return Math.max(Math.round(Number(trimmed) / DURATION_STEP) * DURATION_STEP, DURATION_STEP);
}

export interface TimeRangeInput {
  start: string;
  end: string;
  duration: string;
}

/** End time wins over duration when present; both are rounded before comparing. */
export function resolveEndTime({ start, end, duration }: TimeRangeInput): string {
  const startMinutes = roundToFiveMinutes(parseHhmm(start));

  if (end.trim() !== "") {
    const endMinutes = roundToFiveMinutes(parseHhmm(end));
    if (endMinutes <= startMinutes) {
      throw new Error(`結束時間（${formatHhmm(endMinutes)}）必須大於開始時間（${formatHhmm(startMinutes)}）`);
    }
    return formatHhmm(endMinutes);
  }

  const endMinutes = startMinutes + roundDuration(duration);
  if (endMinutes >= MINUTES_PER_DAY) {
    throw new Error("結束時間超過當天 2400，請改填結束時間");
  }
  return formatHhmm(endMinutes);
}
