import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
};

describe("parseEnv", () => {
  it("accepts a valid configuration and applies defaults", () => {
    const env = parseEnv(base);
    expect(env.APP_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("rejects a non-Postgres database URL", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: "mysql://u:p@localhost/db" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("requires a long auth secret", () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("does not echo secret values in the error", () => {
    const secret = "not-a-url-but-a-secret";
    expect(() => parseEnv({ ...base, DATABASE_URL: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });
});
