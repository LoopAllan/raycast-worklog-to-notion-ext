import { describe, expect, it } from "vitest";
import { ACTIONS, DEFAULT_ACTION } from "../lib/actions";
import { loadActionUsage, rankActions, recordActionUsage } from "../lib/action-usage";
import type { KeyValueCache } from "../lib/journal-context";

function memoryCache(initial: Record<string, string> = {}): KeyValueCache & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: (key) => store.get(key),
    set: (key, value) => void store.set(key, value),
    remove: (key) => void store.delete(key),
  };
}

describe("loadActionUsage", () => {
  it("starts with no counts and the default action", () => {
    expect(loadActionUsage(memoryCache())).toEqual({ counts: {}, last: DEFAULT_ACTION });
  });

  it("falls back to defaults when the stored value is corrupt", () => {
    expect(loadActionUsage(memoryCache({ usage: "{oops" }))).toEqual({ counts: {}, last: DEFAULT_ACTION });
  });

  it("ignores a last action that no longer exists", () => {
    const cache = memoryCache({ usage: JSON.stringify({ counts: {}, last: "已刪除" }) });
    expect(loadActionUsage(cache).last).toBe(DEFAULT_ACTION);
  });
});

describe("recordActionUsage", () => {
  it("counts each use and remembers the last one", () => {
    const cache = memoryCache();
    recordActionUsage(cache, "開會");
    recordActionUsage(cache, "開會");
    recordActionUsage(cache, "排查");
    expect(loadActionUsage(cache)).toEqual({ counts: { 開會: 2, 排查: 1 }, last: "排查" });
  });
});

describe("rankActions", () => {
  it("keeps the configured order without usage", () => {
    expect(rankActions({})).toEqual([...ACTIONS]);
  });

  it("puts the most used first and breaks ties by the configured order", () => {
    const ranked = rankActions({ 按摩: 3, 開會: 1, 分析: 1 });
    expect(ranked.slice(0, 4)).toEqual(["按摩", "分析", "開會", "實作"]);
    expect(ranked).toHaveLength(ACTIONS.length);
  });

  it("ignores counts for actions that no longer exist", () => {
    expect(rankActions({ 已刪除: 9 })).toEqual([...ACTIONS]);
  });
});
