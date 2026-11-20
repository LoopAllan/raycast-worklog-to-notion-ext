import { describe, expect, it, vi } from "vitest";
import type { EntryNode } from "../lib/entry";
import type { EntryWriterClient } from "../lib/notion";
import type { RootBlockSummary } from "../lib/position";
import type { Section } from "../lib/sections";
import { writeWorklog } from "../lib/write-worklog";

interface AppendCall {
  block_id: string;
  children: { type: string; heading_2?: { rich_text: { text: { content: string } }[] } }[];
  position?: unknown;
}

/** Returns new IDs plus, like Notion, the existing siblings after the insertion point. */
function fakeWriter(existingIds: string[]) {
  let nextId = 0;
  const calls: AppendCall[] = [];
  const client = {
    blocks: {
      children: {
        append: vi.fn(async (args: AppendCall) => {
          calls.push(args);
          const created = args.children.map(() => ({ object: "block", id: `new-${++nextId}` }));
          const siblings = args.position ? existingIds.map((id) => ({ object: "block", id })) : [];
          return { results: [...created, ...siblings] };
        }),
      },
      delete: vi.fn(),
    },
  } as unknown as EntryWriterClient;
  return { client, calls };
}

const SECTIONS: Section[] = [
  { name: "早安", startMinutes: 540 },
  { name: "午休", startMinutes: 720 },
  { name: "下午", startMinutes: 780 },
  { name: "加班", startMinutes: 1080 },
];
const rootBlocks: RootBlockSummary[] = [
  { id: "synced", text: "", type: "synced_block" },
  { id: "e1000", text: "1000 - 1030 開會", type: "paragraph" },
];
const entry: EntryNode = { type: "paragraph", text: "1305 - 1315 實作", children: [] };

describe("writeWorklog", () => {
  it("writes only the entry when automatic sections are off", async () => {
    const { client, calls } = fakeWriter(["e1000"]);

    await writeWorklog(
      client,
      { pageId: "page", rootBlocks },
      { entry, startMinutes: 785, sections: null, nowMinutes: 790 },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].position).toEqual({ type: "end" });
  });

  it("adds every due section in order, then places the entry under the right one", async () => {
    const { client, calls } = fakeWriter(["e1000"]);

    await writeWorklog(
      client,
      { pageId: "page", rootBlocks },
      { entry, startMinutes: 785, sections: SECTIONS, nowMinutes: 790 },
    );

    const headings = calls.map((call) => call.children[0].heading_2?.rich_text[0].text.content);
    expect(headings).toEqual(["早安", "午休", "下午", undefined]);
    expect(calls.slice(0, 3).every((call) => call.children.map((c) => c.type).join() === "heading_2,divider")).toBe(
      true,
    );
    expect(calls.map((call) => call.position)).toEqual([
      { type: "after_block", after_block: { id: "synced" } }, // 早安: nothing earlier -> after the first block
      { type: "after_block", after_block: { id: "e1000" } }, // 午休: after the last entry before 1200
      { type: "after_block", after_block: { id: "new-4" } }, // 下午: after 午休's divider
      { type: "after_block", after_block: { id: "new-6" } }, // entry 1305: under 下午
    ]);
  });

  it("does not add sections that are not due yet or already exist", async () => {
    const { client, calls } = fakeWriter([]);
    const blocks: RootBlockSummary[] = [
      ...rootBlocks,
      { id: "h", text: "早安", type: "heading_2" },
      { id: "d", text: "", type: "divider" },
    ];

    await writeWorklog(
      client,
      { pageId: "page", rootBlocks: blocks },
      { entry, startMinutes: 600, sections: SECTIONS, nowMinutes: 700 },
    );

    expect(calls).toHaveLength(1);
  });
});
