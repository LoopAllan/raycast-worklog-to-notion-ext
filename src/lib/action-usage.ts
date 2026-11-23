import { ACTIONS, DEFAULT_ACTION } from "./actions";
import type { KeyValueCache } from "./journal-context";

const USAGE_KEY = "usage";

export interface ActionUsage {
  /** How often each action was submitted. */
  counts: Record<string, number>;
  /** The action submitted last, used as the form's default. */
  last: string;
}

const isKnownAction = (action: unknown): action is string =>
  typeof action === "string" && (ACTIONS as readonly string[]).includes(action);

export function loadActionUsage(cache: KeyValueCache): ActionUsage {
  try {
    const stored = JSON.parse(cache.get(USAGE_KEY) ?? "{}") as Partial<ActionUsage>;
    return {
      counts: stored.counts && typeof stored.counts === "object" ? stored.counts : {},
      last: isKnownAction(stored.last) ? stored.last : DEFAULT_ACTION,
    };
  } catch {
    // Usage only affects ordering, so a corrupt value just starts over.
    return { counts: {}, last: DEFAULT_ACTION };
  }
}

export function recordActionUsage(cache: KeyValueCache, action: string): void {
  const { counts } = loadActionUsage(cache);
  const usage: ActionUsage = { counts: { ...counts, [action]: (counts[action] ?? 0) + 1 }, last: action };
  cache.set(USAGE_KEY, JSON.stringify(usage));
}

/** Most used first; ties keep the configured order (Array.prototype.sort is stable). */
export function rankActions(counts: Record<string, number>): string[] {
  return [...ACTIONS].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
}
