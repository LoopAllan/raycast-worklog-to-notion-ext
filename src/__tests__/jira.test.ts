import { describe, expect, it } from "vitest";
import { normalizeTicketKey } from "../lib/jira";

describe("normalizeTicketKey", () => {
  it.each([
    ["VIPOP-45828", "VIPOP-45828"],
    [" vipop-45828 ", "VIPOP-45828"],
    ["PMOJBVIP-123", "PMOJBVIP-123"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeTicketKey(input)).toBe(expected);
  });

  it.each(["", "  "])("returns null for empty %j", (input) => {
    expect(normalizeTicketKey(input)).toBeNull();
  });

  it.each(["ABC-1", "VIPOP-", "VIPOP45828", "VIPOP-12a"])("rejects %s", (input) => {
    expect(() => normalizeTicketKey(input)).toThrow();
  });
});
