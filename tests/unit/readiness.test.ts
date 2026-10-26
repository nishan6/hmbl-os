import { describe, expect, it } from "vitest";
import {
  databaseName,
  expectedTriggers,
  firstFew,
  hoursSince,
  looksLikeScratchDatabase,
  overall,
  severity,
  summarise,
  worst,
} from "@/lib/readiness";

describe("readiness verdicts", () => {
  it("counts each state and takes the worst as the verdict", () => {
    const summary = summarise([{ state: "pass" }, { state: "warn" }, { state: "pass" }]);
    expect(summary).toEqual({ pass: 2, warn: 1, fail: 0 });
    expect(overall(summary)).toBe("warn");
    expect(overall({ pass: 9, warn: 3, fail: 1 })).toBe("fail");
    expect(overall({ pass: 1, warn: 0, fail: 0 })).toBe("pass");
    expect(worst("pass", "warn")).toBe("warn");
    expect(worst("fail", "warn")).toBe("fail");
  });

  it("fails problems only in production", () => {
    expect(severity(true)).toBe("fail");
    expect(severity(false)).toBe("warn");
  });

  it("keeps evidence short", () => {
    expect(firstFew(["a", "b"])).toEqual(["a", "b"]);
    expect(firstFew(["a", "b", "c", "d"], 2)).toEqual(["a", "b", "and 2 more"]);
  });

  it("measures backup age in whole hours", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(hoursSince(new Date("2026-10-27T11:30:00Z"), now)).toBe(0);
    expect(hoursSince(new Date("2026-10-26T09:00:00Z"), now)).toBe(27);
  });
});

describe("database names", () => {
  it("reads the name from a connection string", () => {
    expect(databaseName("postgresql://hmbl:hmbl@localhost:5432/hmbl_live")).toBe("hmbl_live");
    expect(databaseName("postgresql://hmbl:p%40ss@db:5432/hmbl_live?sslmode=require")).toBe(
      "hmbl_live",
    );
    expect(databaseName("not a url")).toBe("unknown");
  });

  it("recognises development, test and scratch databases", () => {
    for (const name of ["hmbl_dev", "hmbl_test", "hmbl_ci", "hmbl_restore_check", "dev"])
      expect(looksLikeScratchDatabase(name)).toBe(true);
    for (const name of ["hmbl_live", "hmbl", "hmbl_production", "devices"])
      expect(looksLikeScratchDatabase(name)).toBe(false);
  });
});

describe("expected database protections", () => {
  it("follows triggers through creation, dropping and renamed or dropped tables", () => {
    const triggers = expectedTriggers([
      `CREATE TRIGGER audit_events_append_only
         BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION f();
       CREATE TRIGGER docs_append_only BEFORE DELETE ON "project_documents" FOR EACH ROW EXECUTE FUNCTION f();
       CREATE CONSTRAINT TRIGGER journals_balanced AFTER UPDATE ON journals
         DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION g();`,
      `DROP TRIGGER docs_append_only ON "project_documents";
       CREATE TRIGGER old_rule BEFORE INSERT ON "drafts" FOR EACH ROW EXECUTE FUNCTION h();
       CREATE TRIGGER kept BEFORE INSERT ON "items" FOR EACH ROW EXECUTE FUNCTION h();
       ALTER TABLE "items" RENAME TO "stock_items";
       DROP TABLE "drafts";`,
    ]);
    expect([...triggers].sort()).toEqual([
      "audit_events.audit_events_append_only",
      "journals.journals_balanced",
      "stock_items.kept",
    ]);
  });
});
