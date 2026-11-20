import type { EntryNode } from "./entry";
import type { JournalContext } from "./journal-context";
import { type EntryWriterClient, insertEntry, insertSection } from "./notion";
import { findInsertPosition, type RootBlockSummary } from "./position";
import { applyInsertion, dueSections, findTimelinePosition, type Section } from "./sections";

export interface WorklogWrite {
  entry: EntryNode;
  startMinutes: number;
  /** Configured sections when automatic sections are on, otherwise null. */
  sections: Section[] | null;
  nowMinutes: number;
}

/**
 * Adds any due section headings first (in order, each placed on the timeline),
 * then the entry. The local block list is updated after each insert, so no
 * extra list request is needed.
 */
export async function writeWorklog(
  client: EntryWriterClient,
  { pageId, rootBlocks }: JournalContext,
  { entry, startMinutes, sections, nowMinutes }: WorklogWrite,
): Promise<void> {
  let blocks: RootBlockSummary[] = rootBlocks;

  if (sections) {
    for (const section of dueSections(blocks, sections, nowMinutes)) {
      const position = findTimelinePosition(blocks, sections, section.startMinutes, { inclusive: false });
      const existingIds = blocks.map((block) => block.id);
      const [headingId, dividerId] = await insertSection(client, pageId, section.name, position, existingIds);
      blocks = applyInsertion(blocks, position, [
        { id: headingId, text: section.name, type: "heading_2" },
        { id: dividerId, text: "", type: "divider" },
      ]);
    }
  }

  const position = sections
    ? findTimelinePosition(blocks, sections, startMinutes, { inclusive: true })
    : findInsertPosition(blocks, startMinutes);
  await insertEntry(
    client,
    pageId,
    entry,
    position,
    blocks.map((block) => block.id),
  );
}
