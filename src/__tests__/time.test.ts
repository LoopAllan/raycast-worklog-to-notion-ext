import { describe, expect, it } from "vitest";
import { formatHhmm, normalizeTime, parseHhmm, resolveEndTime, roundDuration, roundToFiveMinutes } from "../lib/time";

describe("parseHhmm", () => {
  it.each([
    ["1112", 672],
    ["0905", 545],
    ["905", 545],
    ["11:12", 672],
    ["0000", 0],
  ])("parses %s to %i minutes", (input, expected) => {
    expect(parseHhmm(input)).toBe(expected);
  });

  it.each(["", "abc", "2460", "2500", "12345", "11:5"])("rejects %s", (input) => {
    expect(() => parseHhmm(input)).toThrow();
  });
});

describe("roundToFiveMinutes", () => {
  it.each([
    [672, 670], // 1112 -> 1110
    [673, 675], // 1113 -> 1115
    [670, 670],
    [1438, 1435], // 2358 must not overflow past 2355
  ])("rounds %i to %i", (input, expected) => {
    expect(roundToFiveMinutes(input)).toBe(expected);
  });
});

describe("normalizeTime", () => {
  it.each([
    ["1112", "1110"],
    ["1113", "1115"],
    ["1158", "1200"],
    ["930", "0930"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeTime(input)).toBe(expected);
  });
});

describe("formatHhmm", () => {
  it("pads hours and minutes", () => {
    expect(formatHhmm(65)).toBe("0105");
  });
});

describe("roundDuration", () => {
  it.each([
    ["10", 10],
    ["14", 10],
    ["15", 20],
    ["24", 20],
    ["25", 30],
    ["34", 30],
    ["3", 10],
    ["0", 10],
    ["", 10],
  ])("rounds %s to %i", (input, expected) => {
    expect(roundDuration(input)).toBe(expected);
  });

  it.each(["abc", "-5", "1.5"])("rejects %s", (input) => {
    expect(() => roundDuration(input)).toThrow();
  });
});

describe("resolveEndTime", () => {
  it("uses start plus rounded duration when end is empty", () => {
    expect(resolveEndTime({ start: "1010", end: "", duration: "14" })).toBe("1020");
  });

  it("prefers end over duration", () => {
    expect(resolveEndTime({ start: "1010", end: "1112", duration: "10" })).toBe("1110");
  });

  it("rejects end that is not after start", () => {
    expect(() => resolveEndTime({ start: "1010", end: "1010", duration: "10" })).toThrow(/大於/);
  });

  it("rejects end that rounds to the same as start", () => {
    expect(() => resolveEndTime({ start: "1010", end: "1012", duration: "10" })).toThrow(/大於/);
  });

  it("rejects duration that runs past midnight", () => {
    expect(() => resolveEndTime({ start: "2350", end: "", duration: "20" })).toThrow();
  });
});
