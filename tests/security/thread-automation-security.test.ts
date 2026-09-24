import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migration = await readFile(
  new URL(
    "../../packages/database/drizzle/0029_s21_thread_automation_controls.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("S21 thread-automation migration security scope", () => {
  it("adds exactly one pre-ingress authority table without backfill or unrelated mutation", () => {
    expect(migration.match(/CREATE TABLE/gu)).toHaveLength(1);
    expect(migration).toContain('CREATE TABLE "thread_automation_controls"');
    expect(migration).not.toMatch(/\b(?:INSERT INTO|DELETE FROM|DROP TABLE|TRUNCATE)\b/iu);
    expect(migration).not.toMatch(/^\s*UPDATE\s+/gimu);
  });

  it("keeps finite provenance, FORCE RLS, hot lookup, and least privilege explicit", () => {
    for (const state of ["business_eligible", "excluded_personal", "uncertain", "staff_only"])
      expect(migration).toContain(`'${state}'`);
    expect(migration).toContain("thread_automation_controls_staff_provenance_check");
    expect(migration).toContain("thread_automation_controls_thread_unique");
    expect(migration).toContain("thread_automation_controls_hot_lookup_idx");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("organization_id = app.current_organization_id()");
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE");
    expect(migration).not.toMatch(/GRANT[^;]*DELETE/iu);
  });
});
