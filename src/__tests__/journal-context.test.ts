import { APIErrorCode, APIResponseError } from "@notionhq/client";
import { describe, expect, it, vi } from "vitest";
import { loadJournalContext, type JournalClient, type KeyValueCache } from "../lib/journal-context";

const NOW = new Date("2026-11-20T03:00:00Z");
const SETTINGS = { databaseId: "db", dateProperty: "Date" };

function notFound(): APIResponseError {
  return new APIResponseError({
    code: APIErrorCode.ObjectNotFound,
    status: 404,
    message: "not found",
    headers: {},
    rawBodyText: "",
    additional_data: undefined,
    request_id: undefined,
  });
}

function memoryCache(initial: Record<string, string> = {}): KeyValueCache & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: (key) => store.get(key),
    set: (key, value) => void store.set(key, value),
    remove: (key) => void store.delete(key),
  };
}

function fakeClient(options: { missingPageIds?: string[]; todayPageId?: string | null } = {}) {
  const block = (id: string, text: string) => ({
    object: "block",
    id,
    type: "paragraph",
    paragraph: { rich_text: [{ plain_text: text }] },
  });
  const client = {
    databases: { retrieve: vi.fn(async () => ({ data_sources: [{ id: "ds" }] })) },
    dataSources: {
      retrieve: vi.fn(async () => ({ id: "ds" })),
      query: vi.fn(async () => ({
        results: options.todayPageId === null ? [] : [{ object: "page", id: options.todayPageId ?? "page-today" }],
      })),
    },
    blocks: {
      children: {
        list: vi.fn(async ({ block_id }: { block_id: string }) => {
          if (options.missingPageIds?.includes(block_id)) {
            throw notFound();
          }
          return { results: [block(`${block_id}-b1`, "1000 - 1030 開會")], has_more: false, next_cursor: null };
        }),
      },
    },
  };
  return client;
}

describe("loadJournalContext", () => {
  it("resolves everything on a cold cache and remembers the IDs", async () => {
    const client = fakeClient();
    const cache = memoryCache();

    const context = await loadJournalContext(client as unknown as JournalClient, SETTINGS, cache, NOW);

    expect(context.pageId).toBe("page-today");
    expect(context.rootBlocks).toEqual([{ id: "page-today-b1", text: "1000 - 1030 開會", type: "paragraph" }]);
    expect(cache.store.get("dataSource:db")).toBe("ds");
    expect(cache.store.get("page:db:2026-11-20")).toBe("page-today");
  });

  it("only lists blocks when today's page is cached", async () => {
    const client = fakeClient();
    const cache = memoryCache({ "dataSource:db": "ds", "page:db:2026-11-20": "page-cached" });

    const context = await loadJournalContext(client as unknown as JournalClient, SETTINGS, cache, NOW);

    expect(context.pageId).toBe("page-cached");
    expect(client.databases.retrieve).not.toHaveBeenCalled();
    expect(client.dataSources.query).not.toHaveBeenCalled();
  });

  it("drops a cached page that no longer exists and looks it up again", async () => {
    const client = fakeClient({ missingPageIds: ["page-deleted"] });
    const cache = memoryCache({ "dataSource:db": "ds", "page:db:2026-11-20": "page-deleted" });

    const context = await loadJournalContext(client as unknown as JournalClient, SETTINGS, cache, NOW);

    expect(context.pageId).toBe("page-today");
    expect(cache.store.get("page:db:2026-11-20")).toBe("page-today");
  });

  it("re-resolves a cached data source that no longer exists", async () => {
    const client = fakeClient();
    client.dataSources.query.mockRejectedValueOnce(notFound());
    const cache = memoryCache({ "dataSource:db": "stale-ds" });

    const context = await loadJournalContext(client as unknown as JournalClient, SETTINGS, cache, NOW);

    expect(context.pageId).toBe("page-today");
    expect(cache.store.get("dataSource:db")).toBe("ds");
  });

  it("does not cache a missing page so it is found once created", async () => {
    const client = fakeClient({ todayPageId: null });
    const cache = memoryCache({ "dataSource:db": "ds" });

    await expect(loadJournalContext(client as unknown as JournalClient, SETTINGS, cache, NOW)).rejects.toThrow(
      /找不到今天/,
    );
    expect(cache.store.has("page:db:2026-11-20")).toBe(false);
  });
});
