import { describe, expect, it } from "vitest";
import { diffChanges } from "@/server/audit/diff";

describe("diffChanges", () => {
  it("lists only the fields that changed", () => {
    expect(
      diffChanges({ name: "A", city: "Pune", code: "X" }, { name: "B", city: "Pune", code: "X" }, [
        "name",
        "city",
        "code",
      ]),
    ).toEqual({ name: { from: "A", to: "B" } });
  });

  it("returns null when nothing changed", () => {
    expect(diffChanges({ a: 1 }, { a: 1 }, ["a"])).toBeNull();
  });

  it("treats creation as from null", () => {
    expect(diffChanges(null, { a: 1, b: undefined }, ["a", "b"])).toEqual({
      a: { from: null, to: 1 },
    });
  });

  it("serialises dates and bigints", () => {
    const d = new Date("2026-04-01T00:00:00Z");
    const before: Record<string, unknown> = { at: null, n: 1n };
    expect(diffChanges(before, { at: d, n: 2n }, ["at", "n"])).toEqual({
      at: { from: null, to: "2026-04-01T00:00:00.000Z" },
      n: { from: "1", to: "2" },
    });
  });

  it("never records sensitive values", () => {
    expect(diffChanges({ passwordHash: "a" }, { passwordHash: "b" }, ["passwordHash"])).toEqual({
      passwordHash: { from: "[redacted]", to: "[redacted]" },
    });
  });
});
