import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("accepts a valid configuration and applies defaults", () => {
    const env = parseEnv({ DATABASE_URL: "postgresql://u:p@localhost:5432/db" });
    expect(env.APP_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("rejects a non-Postgres database URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://u:p@localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("does not echo secret values in the error", () => {
    const secret = "not-a-url-but-a-secret";
    expect(() => parseEnv({ DATABASE_URL: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });
});
