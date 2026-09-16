import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const folder = new URL("../../packages/database/drizzle/", import.meta.url);
const sql = await readFile(new URL("0027_s11_instagram_identity_routing.sql", folder), "utf8");
describe("S11.B migration source invariants (real PostgreSQL proof is separate)", () => {
  it("keeps the shared Telegram-before-Instagram selector on existing identity columns", async () => {
    const telegram = await readFile(
      new URL("../../packages/database/src/repositories/telegram.ts", import.meta.url),
      "utf8",
    );
    const identities = await readFile(
      new URL("../../packages/database/src/schema/customer-records.ts", import.meta.url),
      "utf8",
    );
    expect(identities).not.toContain('"is_primary"');
    expect(telegram).not.toContain("is_primary");
    expect(telegram).toContain("order by created_at asc limit 1");
  });
  it("keeps all 27 historical SQL migrations byte-identical", async () => {
    const names = (await readdir(folder))
      .filter((name) => /^00(?:0[0-9]|1[0-9]|2[0-6])_.*\.sql$/u.test(name))
      .sort();
    expect(names).toHaveLength(27);
    const hash = createHash("sha256");
    for (const name of names) {
      hash.update(name);
      hash.update(await readFile(new URL(name, folder)));
    }
    expect(hash.digest("hex")).toBe(
      "4528878af70ef7bec527fd18f75602b21d5bf09262e4fcbb3083be34887d6de0",
    );
  });
  it("has only 0027, 51 business tables, and a timestamp newer than 0026", async () => {
    const files = await readdir(folder);
    expect(files.some((name) => name.startsWith("0028_"))).toBe(false);
    const snapshot: unknown = JSON.parse(
      await readFile(new URL("meta/0027_snapshot.json", folder), "utf8"),
    );
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      !("tables" in snapshot) ||
      typeof snapshot.tables !== "object" ||
      snapshot.tables === null
    )
      throw new Error("Invalid snapshot");
    expect(Object.keys(snapshot.tables)).toHaveLength(51);
    const journal: unknown = JSON.parse(
      await readFile(new URL("meta/_journal.json", folder), "utf8"),
    );
    if (
      typeof journal !== "object" ||
      journal === null ||
      !("entries" in journal) ||
      !Array.isArray(journal.entries)
    )
      throw new Error("Invalid journal");
    expect(journal.entries).toHaveLength(28);
    let previous = -1;
    const entries: readonly unknown[] = journal.entries;
    for (const entry of entries) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("when" in entry) ||
        typeof entry.when !== "number"
      )
        throw new Error("Invalid migration time");
      expect(entry.when).toBeGreaterThan(previous);
      previous = entry.when;
    }
  });
  it("expands only the finite route and identity vocabulary and preserves same-tenant enforcement", () => {
    expect(sql).toContain("'widget_key', 'telegram_webhook', 'instagram_webhook'");
    expect(sql).toContain(
      "'widget_participant', 'telegram_user', 'instagram_user', 'phone', 'email'",
    );
    expect(sql).toContain(
      '"identity_type" <> \'instagram_user\' or "contact_identities"."channel_connection_id" is not null',
    );
    expect(sql).not.toMatch(
      /CREATE TABLE|DROP TABLE|CREATE TRIGGER|DISABLE ROW LEVEL|NO FORCE|input_organization|input_channel_type/iu,
    );
  });
  it("preserves the minimum exact resolver and adds only three IG-only definer mutations", () => {
    expect(sql.match(/CREATE FUNCTION app\./gu)).toHaveLength(3);
    expect(sql.match(/SECURITY DEFINER/gu)).toHaveLength(4);
    expect(sql.match(/SET search_path = pg_catalog/gu)).toHaveLength(4);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION app.resolve_inbound_route");
    expect(sql).toContain("ROWS 1");
    expect(sql).toContain("STABLE");
    expect(sql).toContain("STRICT");
    expect(sql.match(/tenant_id uuid := app.current_organization_id\(\)/gu)).toHaveLength(3);
    expect(sql).toContain("channel_type = 'instagram'");
    expect(sql).toContain("route_key_hash = input_expected_route_key_hash");
    expect(sql).toContain("EXCEPTION WHEN unique_violation");
    expect(sql).not.toMatch(
      /EXECUTE\s+(?:format|pg_catalog)|GRANT.*lead_agent_inbound_route_definer TO/iu,
    );
    expect(sql.match(/OWNER TO lead_agent_inbound_route_definer/gu)).toHaveLength(4);
    expect(sql).toContain("FROM PUBLIC, lead_agent_runtime, lead_agent_ingress");
    expect(sql).toContain("FROM PUBLIC, lead_agent_ingress");
  });
  it("keeps repository routing behind the narrow functions and uses only existing identity columns", async () => {
    const repository = await readFile(
      new URL("../../packages/database/src/repositories/instagram.ts", import.meta.url),
      "utf8",
    );
    expect(repository).not.toMatch(
      /(?:insert into|update|delete from|from|join)\s+(?:public\.)?inbound_routes|is_primary/iu,
    );
    for (const name of ["create", "rotate", "disable"])
      expect(repository).toContain(`app.${name}_instagram_inbound_route`);
    expect(repository).toContain("identity_type='instagram_user'");
    expect(repository).toContain("organization_id=$1");
  });
  it("allows ContactIdentityAdded V2 without allowing arbitrary V2 event vocabulary", () => {
    expect(sql).toContain("'lead.reopened', 'contact.identity_added'");
    expect(sql).toContain(
      "\"event_type\" not in ('lead.reopened', 'contact.identity_added') and \"outbox_events\".\"schema_version\" = '1'",
    );
  });
});
