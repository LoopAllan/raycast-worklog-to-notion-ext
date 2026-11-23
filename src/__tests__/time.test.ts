import { describe, expect, it } from "vitest";
import { formatHhmm, normalizeTime, parseHhmm, resolveEndTime, roundToFiveMinutes } from "../lib/time";

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

describe("resolveEndTime", () => {
  it("rounds the end time", () => {
    expect(resolveEndTime({ start: "1010", end: "1112" })).toBe("1110");
  });

  it.each(["", "   "])("requires an end time (%j)", (end) => {
    expect(() => resolveEndTime({ start: "1010", end })).toThrow(/結束時間/);
  });

  it("rejects end that is not after start", () => {
    expect(() => resolveEndTime({ start: "1010", end: "1010" })).toThrow(/大於/);
  });

  it("rejects end that rounds to the same as start", () => {
    expect(() => resolveEndTime({ start: "1010", end: "1012" })).toThrow(/大於/);
  });
});
