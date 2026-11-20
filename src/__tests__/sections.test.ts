import { describe, expect, it } from "vitest";
import type { RootBlockSummary } from "../lib/position";
import { applyInsertion, dueSections, findTimelinePosition, parseSections, type Section } from "../lib/sections";

const SECTIONS: Section[] = [
  { name: "早上", startMinutes: 540 },
  { name: "午休", startMinutes: 720 },
  { name: "下午", startMinutes: 780 },
  { name: "加班", startMinutes: 1080 },
];

const synced: RootBlockSummary = { id: "synced", text: "", type: "synced_block" };
const entry = (hhmm: string, end = "9999"): RootBlockSummary => ({
  id: `e${hhmm}`,
  text: `${hhmm} - ${end} 實作`,
  type: "paragraph",
});
const heading = (name: string): RootBlockSummary => ({ id: `h-${name}`, text: name, type: "heading_2" });
const divider = (name: string): RootBlockSummary => ({ id: `d-${name}`, text: "", type: "divider" });
const section = (name: string) => [heading(name), divider(name)];

describe("parseSections", () => {
  it("normalizes each configured start time", () => {
    expect(parseSections({ 早上: "0900", 午休: "1158", 下午: "1300", 加班: "1800" })).toEqual([
      { name: "早上", startMinutes: 540 },
      { name: "午休", startMinutes: 720 },
      { name: "下午", startMinutes: 780 },
      { name: "加班", startMinutes: 1080 },
    ]);
  });

  it("names the section whose time is invalid", () => {
    expect(() => parseSections({ 早上: "0900", 午休: "noon", 下午: "1300", 加班: "1800" })).toThrow(/午休/);
  });

  it("requires the sections to be in chronological order", () => {
    expect(() => parseSections({ 早上: "0900", 午休: "1400", 下午: "1300", 加班: "1800" })).toThrow(/順序/);
  });
});

describe("dueSections", () => {
  it("returns missing sections whose start time has passed, in order", () => {
    expect(dueSections([synced, entry("1000")], SECTIONS, 790).map((s) => s.name)).toEqual(["早上", "午休", "下午"]);
  });

  it("skips sections that already exist", () => {
    const blocks = [synced, ...section("早上"), entry("1000")];
    expect(dueSections(blocks, SECTIONS, 790).map((s) => s.name)).toEqual(["午休", "下午"]);
  });

  it("includes a section exactly at its start time", () => {
    expect(dueSections([], SECTIONS, 540).map((s) => s.name)).toEqual(["早上"]);
  });

  it("returns nothing before the first section starts", () => {
    expect(dueSections([], SECTIONS, 530)).toEqual([]);
  });

  it("does not treat an entry paragraph with the same text as the section heading", () => {
    const blocks = [{ id: "p", text: "早上", type: "paragraph" }];
    expect(dueSections(blocks, SECTIONS, 540).map((s) => s.name)).toEqual(["早上"]);
  });
});

describe("findTimelinePosition", () => {
  it("puts the first section before the first entry, below non-timeline blocks", () => {
    expect(findTimelinePosition([synced, entry("1000")], SECTIONS, 540, { inclusive: false })).toEqual({
      type: "after_block",
      after_block: { id: "synced" },
    });
  });

  it("puts a section after the last entry that starts before it", () => {
    const blocks = [synced, ...section("早上"), entry("1000"), entry("1300")];
    expect(findTimelinePosition(blocks, SECTIONS, 780, { inclusive: false })).toEqual({
      type: "after_block",
      after_block: { id: "e1000" },
    });
  });

  it("puts a section right after an earlier section when no entry is in between", () => {
    const blocks = [synced, ...section("早上"), entry("1000"), ...section("午休")];
    expect(findTimelinePosition(blocks, SECTIONS, 780, { inclusive: false })).toEqual({
      type: "after_block",
      after_block: { id: "d-午休" },
    });
  });

  const fullDay = [synced, ...section("早上"), entry("1000"), ...section("午休"), ...section("下午"), entry("1400")];

  it("puts a late-logged morning entry back in the morning", () => {
    expect(findTimelinePosition(fullDay, SECTIONS, 690, { inclusive: true })).toEqual({
      type: "after_block",
      after_block: { id: "e1000" },
    });
  });

  it("puts an entry starting exactly at a section under that section", () => {
    expect(findTimelinePosition(fullDay, SECTIONS, 780, { inclusive: true })).toEqual({
      type: "after_block",
      after_block: { id: "d-下午" },
    });
  });

  it("puts an entry after the last entry of the day", () => {
    expect(findTimelinePosition(fullDay, SECTIONS, 900, { inclusive: true })).toEqual({
      type: "after_block",
      after_block: { id: "e1400" },
    });
  });

  it("puts an entry before everything when it is the earliest", () => {
    expect(findTimelinePosition([entry("1000")], SECTIONS, 500, { inclusive: true })).toEqual({ type: "start" });
  });

  it("falls back to right after the first block when nothing earlier exists", () => {
    expect(findTimelinePosition([synced], SECTIONS, 540, { inclusive: false })).toEqual({
      type: "after_block",
      after_block: { id: "synced" },
    });
  });

  it("ignores headings that are not configured sections", () => {
    const blocks = [synced, heading("早上"), divider("早上"), entry("1000")];
    expect(findTimelinePosition(blocks, SECTIONS, 540, { inclusive: false })).toEqual({
      type: "after_block",
      after_block: { id: "synced" },
    });
  });

  it("appends to an empty page", () => {
    expect(findTimelinePosition([], SECTIONS, 540, { inclusive: false })).toEqual({ type: "end" });
  });
});

describe("applyInsertion", () => {
  const blocks = [synced, entry("1000")];
  const added = section("早上");

  it("inserts after the anchor block", () => {
    expect(applyInsertion(blocks, { type: "after_block", after_block: { id: "synced" } }, added)).toEqual([
      synced,
      ...added,
      entry("1000"),
    ]);
  });

  it("inserts at the start and the end", () => {
    expect(applyInsertion(blocks, { type: "start" }, added)).toEqual([...added, ...blocks]);
    expect(applyInsertion(blocks, { type: "end" }, added)).toEqual([...blocks, ...added]);
  });
});
