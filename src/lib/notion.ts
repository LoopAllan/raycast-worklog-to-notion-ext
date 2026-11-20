import { APIErrorCode, Client, collectPaginatedAPI, isFullBlock, isNotionClientError } from "@notionhq/client";
import type { BlockObjectRequest, BlockObjectResponse } from "@notionhq/client";
import { localDayRange } from "./day-range";
import type { EntryNode } from "./entry";
import type { InsertPosition, RootBlockSummary } from "./position";

// Notion rejects a single text object longer than this.
const MAX_TEXT_LENGTH = 2000;

export function createNotionClient(apiKey: string): Client {
  return new Client({ auth: apiKey });
}

export type DataSourceLookupClient = Pick<Client, "databases" | "dataSources">;

export function isObjectNotFound(error: unknown): boolean {
  return isNotionClientError(error) && error.code === APIErrorCode.ObjectNotFound;
}

/** The append response did not contain the expected new blocks, usually because the page changed meanwhile. */
export class UnrecognizedBlocksError extends Error {
  constructor(expected: number, found: number) {
    super(`無法辨識 Notion 新建的區塊（預期 ${expected} 個，找到 ${found} 個）`);
    this.name = "UnrecognizedBlocksError";
  }
}

/** True when the prefetched page snapshot is outdated and a fresh one is worth one retry. */
export function isStaleContextError(error: unknown): boolean {
  return error instanceof UnrecognizedBlocksError || isObjectNotFound(error);
}

/**
 * Accepts either a database ID or a data source ID, since Notion's
 * "Copy data source ID" menu makes the latter easy to paste by mistake.
 */
export async function resolveDataSourceId(client: DataSourceLookupClient, id: string): Promise<string> {
  try {
    const database = await client.databases.retrieve({ database_id: id });
    const dataSources = "data_sources" in database ? database.data_sources : [];
    if (dataSources.length === 0) {
      throw new Error("這個 Notion database 沒有可用的 data source，請確認 Database ID");
    }
    return dataSources[0].id;
  } catch (error) {
    if (!isObjectNotFound(error)) {
      throw error;
    }
  }

  try {
    const dataSource = await client.dataSources.retrieve({ data_source_id: id });
    return dataSource.id;
  } catch (error) {
    if (!isObjectNotFound(error)) {
      throw error;
    }
    throw new Error(
      `找不到 Notion database／data source「${id}」。請確認 ID 正確，並在該 database 的 ⋯ → Connections 加入你的 integration`,
      { cause: error },
    );
  }
}

/** The earliest page whose date property falls on the local "today". */
export async function findTodayPageId(
  client: DataSourceLookupClient,
  dataSourceId: string,
  dateProperty: string,
  now = new Date(),
): Promise<string> {
  const { start, end } = localDayRange(now);

  const response = await client.dataSources.query({
    data_source_id: dataSourceId,
    filter: {
      and: [
        { property: dateProperty, date: { on_or_after: start } },
        { property: dateProperty, date: { before: end } },
      ],
    },
    sorts: [
      { property: dateProperty, direction: "ascending" },
      { timestamp: "created_time", direction: "ascending" },
    ],
    page_size: 1,
  });

  const page = response.results[0];
  if (!page) {
    throw new Error(`找不到今天（${start.slice(0, 10)}）的工作日誌頁面，請先建立`);
  }
  return page.id;
}

function plainText(block: BlockObjectResponse): string {
  const content = (block as unknown as Record<string, unknown>)[block.type] as
    { rich_text?: { plain_text: string }[] } | undefined;
  return content?.rich_text?.map((part) => part.plain_text).join("") ?? "";
}

export async function listRootBlocks(client: Pick<Client, "blocks">, pageId: string): Promise<RootBlockSummary[]> {
  const blocks = await collectPaginatedAPI(client.blocks.children.list, { block_id: pageId });
  return blocks.filter(isFullBlock).map((block) => ({ id: block.id, text: plainText(block) }));
}

function toRichText(text: string) {
  const chunks = text.match(new RegExp(`[\\s\\S]{1,${MAX_TEXT_LENGTH}}`, "g")) ?? [""];
  return chunks.map((content) => ({ type: "text" as const, text: { content } }));
}

// Notion accepts at most two levels of nesting below a block in one append request.
const MAX_NESTING_PER_REQUEST = 2;

function nodeHeight(node: EntryNode): number {
  return node.children.length === 0 ? 0 : 1 + Math.max(...node.children.map(nodeHeight));
}

function toBlockRequest(node: EntryNode, includeChildren: boolean): BlockObjectRequest {
  const rich_text = toRichText(node.text);
  const children =
    includeChildren && node.children.length > 0 ? node.children.map((child) => toBlockRequest(child, true)) : undefined;
  const content = children ? { rich_text, children } : { rich_text };
  return (
    node.type === "bulleted_list_item"
      ? { type: "bulleted_list_item", bulleted_list_item: content }
      : { type: "paragraph", paragraph: content }
  ) as BlockObjectRequest;
}

export type EntryWriterClient = { blocks: Pick<Client["blocks"], "children" | "delete"> };

interface AppendOptions {
  position?: InsertPosition;
  /** Children the parent already had; Notion's append response may include them. */
  existingIds?: ReadonlySet<string>;
}

/**
 * Writes `nodes` with as few sequential requests as possible. A subtree shallow
 * enough for one request is sent inline; deeper nodes are created first (we need
 * their IDs) and their children are written in parallel afterwards.
 */
async function appendTree(
  client: EntryWriterClient,
  parentId: string,
  nodes: EntryNode[],
  { position, existingIds = new Set() }: AppendOptions = {},
): Promise<string[]> {
  const inline = nodes.map((node) => nodeHeight(node) <= MAX_NESTING_PER_REQUEST);
  const response = await client.blocks.children.append({
    block_id: parentId,
    children: nodes.map((node, index) => toBlockRequest(node, inline[index])),
    ...(position ? { position } : {}),
  });

  // When inserting mid-page, Notion also returns the siblings after the insertion point.
  const createdIds = response.results.map((block) => block.id).filter((id) => !existingIds.has(id));
  if (createdIds.length !== nodes.length) {
    throw new UnrecognizedBlocksError(nodes.length, createdIds.length);
  }

  await Promise.all(
    nodes.map((node, index) =>
      inline[index] || node.children.length === 0 ? undefined : appendTree(client, createdIds[index], node.children),
    ),
  );
  return createdIds;
}

/** Writes the whole entry, or removes the root block again so no half entry is left behind. */
export async function insertEntry(
  client: EntryWriterClient,
  pageId: string,
  entry: EntryNode,
  position: InsertPosition,
  existingRootIds: string[],
): Promise<string> {
  const existingIds = new Set(existingRootIds);
  if (nodeHeight(entry) <= MAX_NESTING_PER_REQUEST) {
    const [rootId] = await appendTree(client, pageId, [entry], { position, existingIds });
    return rootId;
  }

  const [rootId] = await appendTree(client, pageId, [{ ...entry, children: [] }], { position, existingIds });
  try {
    await appendTree(client, rootId, entry.children);
  } catch (error) {
    await client.blocks.delete({ block_id: rootId }).catch((cleanupError: unknown) => {
      throw new Error(`寫入失敗，且無法移除已寫入的「${entry.text}」，請手動刪除`, {
        cause: [error, cleanupError],
      });
    });
    throw error;
  }
  return rootId;
}
