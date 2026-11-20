import { type InsertPosition, parseEntryStart, type RootBlockSummary } from "./position";
import { formatHhmm, normalizeTime, parseHhmm } from "./time";

export const SECTION_NAMES = ["早上", "午休", "下午", "加班"] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

export interface Section {
  name: SectionName;
  startMinutes: number;
}

/** Validates the configured start times; sections must be in chronological order. */
export function parseSections(times: Record<SectionName, string>): Section[] {
  const sections = SECTION_NAMES.map((name) => {
    try {
      return { name, startMinutes: parseHhmm(normalizeTime(times[name])) };
    } catch (error) {
      throw new Error(`時段「${name}」的開始時間無效：${error instanceof Error ? error.message : String(error)}`);
    }
  });

  sections.slice(1).forEach((section, index) => {
    const previous = sections[index];
    if (section.startMinutes <= previous.startMinutes) {
      throw new Error(
        `時段開始時間的順序錯誤：「${section.name}」（${formatHhmm(section.startMinutes)}）必須晚於「${previous.name}」（${formatHhmm(previous.startMinutes)}）`,
      );
    }
  });
  return sections;
}

function isHeading(block: RootBlockSummary): boolean {
  return block.type?.startsWith("heading_") ?? false;
}

function sectionOf(block: RootBlockSummary, sections: Section[]): Section | undefined {
  return isHeading(block) ? sections.find((section) => section.name === block.text.trim()) : undefined;
}

/** Sections that are not on the page yet and whose start time has passed, in order. */
export function dueSections(blocks: RootBlockSummary[], sections: Section[], nowMinutes: number): Section[] {
  return sections.filter(
    (section) => nowMinutes >= section.startMinutes && !blocks.some((block) => sectionOf(block, sections) === section),
  );
}

/**
 * Time of each block on the day's timeline: entries by their start time, a
 * section heading and the divider right below it by the section's start time,
 * anything else null.
 */
function timelineKeys(blocks: RootBlockSummary[], sections: Section[]): (number | null)[] {
  return blocks.map((block, index) => {
    const entryStart = parseEntryStart(block.text);
    if (entryStart !== null) {
      return entryStart;
    }
    const section = sectionOf(block, sections);
    if (section) {
      return section.startMinutes;
    }
    const previous = blocks[index - 1];
    const sectionAbove = block.type === "divider" && previous ? sectionOf(previous, sections) : undefined;
    return sectionAbove ? sectionAbove.startMinutes : null;
  });
}

/**
 * Places something that starts at `minutes` right after the last timeline block
 * before it (entries and earlier sections). `inclusive` lets an entry sit under a
 * section that starts at the same minute; a section itself uses exclusive so it
 * goes above entries that start exactly when it does. With nothing earlier, it
 * goes right after the page's first block (e.g. the synced header), unless that
 * block is itself a later timeline block.
 */
export function findTimelinePosition(
  blocks: RootBlockSummary[],
  sections: Section[],
  minutes: number,
  { inclusive }: { inclusive: boolean },
): InsertPosition {
  const keys = timelineKeys(blocks, sections);
  const isEarlier = (key: number | null) => key !== null && (inclusive ? key <= minutes : key < minutes);
  const anchorIndex = keys.findLastIndex(isEarlier);

  if (anchorIndex !== -1) {
    return { type: "after_block", after_block: { id: blocks[anchorIndex].id } };
  }
  if (blocks.length === 0) {
    return { type: "end" };
  }
  if (keys[0] !== null) {
    return { type: "start" };
  }
  return { type: "after_block", after_block: { id: blocks[0].id } };
}

/** The page's root blocks after `added` is inserted at `position`, to avoid re-listing the page. */
export function applyInsertion(
  blocks: RootBlockSummary[],
  position: InsertPosition,
  added: RootBlockSummary[],
): RootBlockSummary[] {
  if (position.type === "start") {
    return [...added, ...blocks];
  }
  if (position.type === "end") {
    return [...blocks, ...added];
  }
  const index = blocks.findIndex((block) => block.id === position.after_block.id);
  if (index === -1) {
    throw new Error(`找不到插入位置的區塊 ${position.after_block.id}`);
  }
  return [...blocks.slice(0, index + 1), ...added, ...blocks.slice(index + 1)];
}
