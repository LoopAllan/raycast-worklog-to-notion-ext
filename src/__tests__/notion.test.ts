import { APIErrorCode, APIResponseError } from "@notionhq/client";
import { describe, expect, it, vi } from "vitest";
import type { EntryNode } from "../lib/entry";
import {
  insertEntry,
  isStaleContextError,
  UnrecognizedBlocksError,
  resolveDataSourceId,
  type DataSourceLookupClient,
  type EntryWriterClient,
} from "../lib/notion";

function notFound(): APIResponseError {
  return new APIResponseError({
    code: APIErrorCode.ObjectNotFound,
    status: 404,
    message: "Could not find database",
    headers: {},
    rawBodyText: "",
    additional_data: undefined,
    request_id: undefined,
  });
}

function stubClient(overrides: {
  database?: () => Promise<unknown>;
  dataSource?: () => Promise<unknown>;
}): DataSourceLookupClient {
  return {
    databases: { retrieve: vi.fn(overrides.database ?? (() => Promise.reject(notFound()))) },
    dataSources: { retrieve: vi.fn(overrides.dataSource ?? (() => Promise.reject(notFound()))) },
  } as unknown as DataSourceLookupClient;
}

describe("resolveDataSourceId", () => {
  it("uses the first data source of a database ID", async () => {
    const client = stubClient({ database: async () => ({ data_sources: [{ id: "ds-1" }, { id: "ds-2" }] }) });
    await expect(resolveDataSourceId(client, "db")).resolves.toBe("ds-1");
  });

  it("accepts a data source ID when the database lookup is not found", async () => {
    const client = stubClient({ dataSource: async () => ({ id: "ds-direct" }) });
    await expect(resolveDataSourceId(client, "ds-direct")).resolves.toBe("ds-direct");
  });

  it("explains how to fix access when neither lookup finds the ID", async () => {
    await expect(resolveDataSourceId(stubClient({}), "missing")).rejects.toThrow(/Connections/);
  });

  it("does not hide other errors such as an invalid token", async () => {
    const unauthorized = new APIResponseError({
      code: APIErrorCode.Unauthorized,
      status: 401,
      message: "API token is invalid.",
      headers: {},
      rawBodyText: "",
      additional_data: undefined,
      request_id: undefined,
    });
    const client = stubClient({ database: () => Promise.reject(unauthorized) });
    await expect(resolveDataSourceId(client, "db")).rejects.toBe(unauthorized);
  });
});

interface AppendCall {
  block_id: string;
  children: { type: string; [key: string]: unknown }[];
  position?: unknown;
}

/**
 * Mimics Notion: appending with a position also returns the sibling blocks
 * that follow the inserted ones, not only the newly created blocks.
 */
function fakeWriter(options: { followingSiblingIds?: string[]; failOnCall?: number } = {}) {
  let nextId = 0;
  const calls: AppendCall[] = [];
  const deleted: string[] = [];
  const client = {
    blocks: {
      children: {
        append: vi.fn(async (args: AppendCall) => {
          calls.push(args);
          if (options.failOnCall === calls.length) {
            throw new Error("boom");
          }
          const created = args.children.map(() => ({ object: "block", id: `new-${++nextId}` }));
          const siblings = args.position
            ? (options.followingSiblingIds ?? []).map((id) => ({ object: "block", id }))
            : [];
          return { results: [...created, ...siblings] };
        }),
      },
      delete: vi.fn(async ({ block_id }: { block_id: string }) => {
        deleted.push(block_id);
        return {};
      }),
    },
  } as unknown as EntryWriterClient;
  return { client, calls, deleted };
}

function node(text: string, children: EntryNode[] = []): EntryNode {
  return { type: "paragraph", text, children };
}

/** Counts nesting below a block request, e.g. a leaf is 0. */
function nestingDepth(block: { [key: string]: unknown }): number {
  const content = block[block.type as string] as { children?: { [key: string]: unknown }[] };
  const children = content.children ?? [];
  return children.length === 0 ? 0 : 1 + Math.max(...children.map(nestingDepth));
}

// root -> ticket -> description line -> bullet -> nested bullet (the screenshot case)
const deepTree = node("1010 - 1020 實作", [
  node("VIPOP-1 x", [node("d", [node("b1", [node("aaaaaa")]), node("b2")]), node("d2")]),
]);

describe("insertEntry", () => {
  const position = { type: "after_block", after_block: { id: "existing-1" } } as const;

  it("writes a typical entry (ticket + flat description) in a single request", async () => {
    const { client, calls } = fakeWriter({ followingSiblingIds: ["existing-2"] });
    const typical = node("1010 - 1020 實作", [node("VIPOP-1 x", [node("d1"), node("d2")])]);

    await expect(insertEntry(client, "page", typical, position, ["existing-1", "existing-2"])).resolves.toBe("new-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].position).toEqual(position);
    expect(nestingDepth(calls[0].children[0])).toBe(2);
  });

  it("needs only one request per level that still has deep children", async () => {
    const { client, calls } = fakeWriter({ followingSiblingIds: ["existing-2", "existing-3"] });

    const rootId = await insertEntry(client, "page", deepTree, position, ["existing-1", "existing-2", "existing-3"]);

    expect(rootId).toBe("new-1");
    expect(calls.map((call) => call.block_id)).toEqual(["page", "new-1", "new-2"]);
    expect(calls.slice(1).every((call) => call.position === undefined)).toBe(true);
    // The last request carries the remaining subtree, nested as deep as Notion allows.
    expect(Math.max(...calls[2].children.map(nestingDepth))).toBe(2);
  });

  it("never nests more than two levels in one request", async () => {
    const { client, calls } = fakeWriter();
    await insertEntry(client, "page", deepTree, position, []);
    for (const call of calls) {
      for (const child of call.children) {
        expect(nestingDepth(child)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("removes the half-written entry when a nested append fails", async () => {
    const { client, deleted } = fakeWriter({ failOnCall: 2 });

    await expect(insertEntry(client, "page", deepTree, position, ["existing-1"])).rejects.toThrow("boom");
    expect(deleted).toEqual(["new-1"]);
  });
});

describe("isStaleContextError", () => {
  it("retries when the anchor block is gone or the response cannot be matched", () => {
    expect(isStaleContextError(notFound())).toBe(true);
    expect(isStaleContextError(new UnrecognizedBlocksError(1, 2))).toBe(true);
  });

  it("does not retry unrelated failures", () => {
    expect(isStaleContextError(new Error("boom"))).toBe(false);
    const unauthorized = new APIResponseError({
      code: APIErrorCode.Unauthorized,
      status: 401,
      message: "API token is invalid.",
      headers: {},
      rawBodyText: "",
      additional_data: undefined,
      request_id: undefined,
    });
    expect(isStaleContextError(unauthorized)).toBe(false);
  });
});
