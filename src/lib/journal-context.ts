import type { Client } from "@notionhq/client";
import { localDayRange } from "./day-range";
import { findTodayPageId, isObjectNotFound, listRootBlocks, resolveDataSourceId } from "./notion";
import type { RootBlockSummary } from "./position";

/** Matches Raycast's `Cache`, kept as an interface so the logic stays testable. */
export interface KeyValueCache {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export type JournalClient = Pick<Client, "databases" | "dataSources" | "blocks">;

export interface JournalSettings {
  databaseId: string;
  dateProperty: string;
}

export interface JournalContext {
  pageId: string;
  rootBlocks: RootBlockSummary[];
}

async function cachedDataSourceId(
  client: JournalClient,
  databaseId: string,
  cache: KeyValueCache,
  key: string,
): Promise<{ id: string; fromCache: boolean }> {
  const cached = cache.get(key);
  if (cached) {
    return { id: cached, fromCache: true };
  }
  const id = await resolveDataSourceId(client, databaseId);
  cache.set(key, id);
  return { id, fromCache: false };
}

async function lookUpTodayPage(
  client: JournalClient,
  { databaseId, dateProperty }: JournalSettings,
  cache: KeyValueCache,
  now: Date,
): Promise<string> {
  const dataSourceKey = `dataSource:${databaseId}`;
  const dataSource = await cachedDataSourceId(client, databaseId, cache, dataSourceKey);
  try {
    return await findTodayPageId(client, dataSource.id, dateProperty, now);
  } catch (error) {
    if (!dataSource.fromCache || !isObjectNotFound(error)) {
      throw error;
    }
    cache.remove(dataSourceKey);
    const fresh = await cachedDataSourceId(client, databaseId, cache, dataSourceKey);
    return findTodayPageId(client, fresh.id, dateProperty, now);
  }
}

/**
 * Finds today's journal page and its root blocks. IDs are cached so a warm run
 * costs a single list request; stale cache entries are dropped and retried.
 */
export async function loadJournalContext(
  client: JournalClient,
  settings: JournalSettings,
  cache: KeyValueCache,
  now = new Date(),
): Promise<JournalContext> {
  const pageKey = `page:${settings.databaseId}:${localDayRange(now).start.slice(0, 10)}`;

  const cachedPageId = cache.get(pageKey);
  if (cachedPageId) {
    try {
      return { pageId: cachedPageId, rootBlocks: await listRootBlocks(client, cachedPageId) };
    } catch (error) {
      if (!isObjectNotFound(error)) {
        throw error;
      }
      cache.remove(pageKey);
    }
  }

  const pageId = await lookUpTodayPage(client, settings, cache, now);
  cache.set(pageKey, pageId);
  return { pageId, rootBlocks: await listRootBlocks(client, pageId) };
}
