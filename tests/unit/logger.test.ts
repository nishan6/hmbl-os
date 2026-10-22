import { describe, expect, it } from "vitest";
import { redact } from "@/lib/logger";

describe("redact", () => {
  it("replaces sensitive keys at any depth", () => {
    expect(
      redact({ user: "a", password: "x", nested: { apiKey: "y", list: [{ token: "z" }] } }),
    ).toEqual({
      user: "a",
      password: "[redacted]",
      nested: { apiKey: "[redacted]", list: [{ token: "[redacted]" }] },
    });
  });

  it("reduces errors to name and message", () => {
    expect(redact(new TypeError("boom"))).toEqual({ name: "TypeError", message: "boom" });
  });
});
