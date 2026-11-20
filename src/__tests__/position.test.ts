import { describe, expect, it } from "vitest";
import { findInsertPosition, parseEntryStart } from "../lib/position";

const blocks = [
  { id: "synced", text: "" },
  { id: "h-morning", text: "早上" },
  { id: "div1", text: "" },
  { id: "e1000", text: "1000 - 1030 開會" },
  { id: "e1030", text: "1030 - 1150 實作" },
  { id: "h-lunch", text: "午休" },
  { id: "div2", text: "" },
  { id: "empty", text: "" },
  { id: "h-afternoon", text: "下午" },
  { id: "div3", text: "" },
  { id: "e1400", text: "1400 - 1730 實作" },
  { id: "tail", text: "" },
];

describe("parseEntryStart", () => {
  it.each([
    ["1000 - 1030 開會", 600],
    ["1400-1730 實作", 840],
    ["早上", null],
    ["2026 年度目標", null],
    ["", null],
  ])("parses %s", (text, expected) => {
    expect(parseEntryStart(text)).toBe(expected);
  });
});

describe("findInsertPosition", () => {
  it("inserts right before the first entry that starts later", () => {
    expect(findInsertPosition(blocks, 615)).toEqual({ type: "after_block", after_block: { id: "e1000" } });
  });

  it("fills a gap right before the next later entry, even across headings", () => {
    expect(findInsertPosition(blocks, 660)).toEqual({ type: "after_block", after_block: { id: "div3" } });
  });

  it("keeps afternoon entries under the afternoon heading", () => {
    expect(findInsertPosition(blocks, 780)).toEqual({ type: "after_block", after_block: { id: "div3" } });
  });

  it("places equal start times after the existing entry", () => {
    expect(findInsertPosition(blocks, 600)).toEqual({ type: "after_block", after_block: { id: "e1000" } });
  });

  it("appends to the end when nothing starts later", () => {
    expect(findInsertPosition(blocks, 1080)).toEqual({ type: "end" });
  });

  it("appends to the end of an empty page", () => {
    expect(findInsertPosition([], 600)).toEqual({ type: "end" });
  });

  it("inserts at the start when the first block starts later", () => {
    expect(findInsertPosition([{ id: "e1400", text: "1400 - 1500 實作" }], 600)).toEqual({ type: "start" });
  });
});
