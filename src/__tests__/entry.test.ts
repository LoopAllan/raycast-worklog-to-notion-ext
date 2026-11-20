import { describe, expect, it } from "vitest";
import { buildEntryTree, parseDescription } from "../lib/entry";

describe("parseDescription", () => {
  it("returns no nodes for blank input", () => {
    expect(parseDescription("  \n\n")).toEqual([]);
  });

  it("turns each line into a sibling paragraph", () => {
    expect(parseDescription("a\nb")).toEqual([
      { type: "paragraph", text: "a", children: [] },
      { type: "paragraph", text: "b", children: [] },
    ]);
  });

  it("nests indented lines under the previous less-indented line and makes '- ' lines bullets", () => {
    expect(parseDescription("將 base image 放到 package\n    - 跟馬丁要帳密\n    - 發現還是不行\nnext")).toEqual([
      {
        type: "paragraph",
        text: "將 base image 放到 package",
        children: [
          { type: "bulleted_list_item", text: "跟馬丁要帳密", children: [] },
          { type: "bulleted_list_item", text: "發現還是不行", children: [] },
        ],
      },
      { type: "paragraph", text: "next", children: [] },
    ]);
  });

  it("supports tab indentation and deeper nesting", () => {
    const [root] = parseDescription("a\n\tb\n\t\tc");
    expect(root.children[0].text).toBe("b");
    expect(root.children[0].children[0].text).toBe("c");
  });
});

describe("buildEntryTree", () => {
  const base = { start: "1010", end: "1015", action: "按摩" };

  it("builds only the root line without ticket or description", () => {
    expect(buildEntryTree({ ...base })).toEqual({ type: "paragraph", text: "1010 - 1015 按摩", children: [] });
  });

  it("puts the ticket line under the root", () => {
    expect(buildEntryTree({ ...base, action: "實作", ticketLine: "VIPOP-45828 小赫開發" })).toEqual({
      type: "paragraph",
      text: "1010 - 1015 實作",
      children: [{ type: "paragraph", text: "VIPOP-45828 小赫開發", children: [] }],
    });
  });

  it("puts description directly under the root when there is no ticket", () => {
    expect(buildEntryTree({ ...base, action: "開會", description: "VIP ATS 開會" })).toEqual({
      type: "paragraph",
      text: "1010 - 1015 開會",
      children: [{ type: "paragraph", text: "VIP ATS 開會", children: [] }],
    });
  });

  it("puts description under the ticket line when both exist", () => {
    const tree = buildEntryTree({ ...base, action: "實作", ticketLine: "VIPOP-1 x", description: "d1\nd2" });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].children.map((n) => n.text)).toEqual(["d1", "d2"]);
  });
});
