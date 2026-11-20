import { describe, expect, it } from "vitest";
import { localDayRange } from "../lib/day-range";

describe("localDayRange", () => {
  it("covers the local calendar day with the local UTC offset (UTC+8)", () => {
    // 2026-11-20 00:30 in Taipei is still 2026-11-19 in UTC.
    const now = new Date("2026-11-19T16:30:00Z");
    expect(localDayRange(now, -480)).toEqual({
      start: "2026-11-20T00:00:00+08:00",
      end: "2026-11-21T00:00:00+08:00",
    });
  });

  it("handles negative offsets and month rollover", () => {
    const now = new Date("2026-12-01T02:00:00Z"); // 2026-11-30 21:00 in UTC-5
    expect(localDayRange(now, 300)).toEqual({
      start: "2026-11-30T00:00:00-05:00",
      end: "2026-12-01T00:00:00-05:00",
    });
  });
});
