import { parseHhmm } from "./time";

export interface RootBlockSummary {
  id: string;
  /** Plain text of the block; empty for blocks without rich text. */
  text: string;
  /** Notion block type, e.g. "paragraph", "heading_2", "divider". */
  type?: string;
}

export type InsertPosition = { type: "after_block"; after_block: { id: string } } | { type: "start" } | { type: "end" };

const ENTRY_PATTERN = /^(\d{4})\s*-\s*\d{4}/;

/** Returns the start time in minutes when the text looks like "mmii - mmii ...", otherwise null. */
export function parseEntryStart(text: string): number | null {
  const match = ENTRY_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  try {
    return parseHhmm(match[1]);
  } catch {
    return null; // e.g. "2560 - ..." is not a time entry, just text that starts with digits
  }
}

/**
 * Inserts right before the first entry starting later (so headings like 午休/下午
 * that sit before it keep grouping entries correctly); otherwise appends at the end.
 */
export function findInsertPosition(blocks: RootBlockSummary[], startMinutes: number): InsertPosition {
  const nextIndex = blocks.findIndex((block) => {
    const entryStart = parseEntryStart(block.text);
    return entryStart !== null && entryStart > startMinutes;
  });

  if (nextIndex === -1) {
    return { type: "end" };
  }
  if (nextIndex === 0) {
    return { type: "start" };
  }
  return { type: "after_block", after_block: { id: blocks[nextIndex - 1].id } };
}
