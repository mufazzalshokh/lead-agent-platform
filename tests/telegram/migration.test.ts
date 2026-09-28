import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sql = await readFile(
  new URL(
    "../../packages/database/drizzle/0026_s11_telegram_inbound_route_management.sql",
    import.meta.url,
  ),
  "utf8",
);
describe("S11.A migration source boundary (not a substitute for PostgreSQL proof)", () => {
  it("adds exactly three fixed-search-path, Telegram-only definer functions", () => {
    expect(sql.match(/CREATE FUNCTION app\./gu)).toHaveLength(3);
    expect(sql.match(/SECURITY DEFINER/gu)).toHaveLength(3);
    expect(sql.match(/SET search_path = pg_catalog/gu)).toHaveLength(3);
    expect(sql.match(/tenant_id uuid := app.current_organization_id\(\)/gu)).toHaveLength(3);
    expect(sql).not.toMatch(
      /input_organization|input_route_type|EXECUTE\s+(?:format|pg_catalog)|CREATE TABLE|DISABLE ROW LEVEL|NO FORCE/iu,
    );
    expect(sql).toContain("AND channel_type = 'telegram'");
  });
  it("uses exact hashes and expected-hash CAS without changing the resolver", () => {
    expect(sql).toContain("octet_length(input_route_key_hash) <> 32");
    expect(sql).toContain("route_key_hash = input_expected_route_key_hash");
    expect(sql).toContain("RETURN changed_rows = 1");
    expect(sql).toContain("EXCEPTION WHEN unique_violation");
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION app.resolve_inbound_route");
  });
  it("grants runtime execution only and denies ingress/PUBLIC", () => {
    expect(sql).toContain("FROM PUBLIC, lead_agent_ingress");
    expect(sql).toContain("TO lead_agent_runtime");
    expect(
      sql.indexOf("GRANT EXECUTE ON FUNCTION app.create_telegram_inbound_route"),
    ).toBeGreaterThan(sql.indexOf("ALTER FUNCTION app.create_telegram_inbound_route"));
    expect(sql.match(/OWNER TO lead_agent_inbound_route_definer/gu)).toHaveLength(3);
    expect(sql).not.toMatch(
      /ON TABLE public.inbound_routes TO lead_agent_runtime|GRANT\s+lead_agent_inbound_route_definer\s+TO\s+lead_agent_(?:runtime|ingress)/iu,
    );
  });
  it("bounds ownership transfer privileges while preserving role administration", () => {
    const nonInheritedIndex = sql.indexOf(
      "GRANT lead_agent_inbound_route_definer TO CURRENT_USER WITH INHERIT FALSE",
    );
    const setGrantIndex = sql.lastIndexOf(
      "GRANT lead_agent_inbound_route_definer TO CURRENT_USER WITH SET TRUE",
    );
    const grantIndex = sql.indexOf(
      "GRANT USAGE, CREATE ON SCHEMA app TO lead_agent_inbound_route_definer",
    );
    const firstOwnerIndex = sql.indexOf("OWNER TO lead_agent_inbound_route_definer");
    const lastOwnerIndex = sql.lastIndexOf("OWNER TO lead_agent_inbound_route_definer");
    const revokeIndex = sql.indexOf(
      "REVOKE CREATE ON SCHEMA app FROM lead_agent_inbound_route_definer",
    );
    const setRevokeIndex = sql.indexOf(
      "GRANT lead_agent_inbound_route_definer TO CURRENT_USER WITH SET FALSE",
    );
    expect(nonInheritedIndex).toBeGreaterThanOrEqual(0);
    expect(setGrantIndex).toBeGreaterThan(nonInheritedIndex);
    expect(grantIndex).toBeGreaterThan(setGrantIndex);
    expect(firstOwnerIndex).toBeGreaterThan(grantIndex);
    expect(revokeIndex).toBeGreaterThan(lastOwnerIndex);
    expect(setRevokeIndex).toBeGreaterThan(revokeIndex);
  });
  it("removes all direct route-table access from the runtime repository", async () => {
    const repository = await readFile(
      new URL("../../packages/database/src/repositories/telegram.ts", import.meta.url),
      "utf8",
    );
    expect(repository).not.toMatch(
      /(?:insert into|update|delete from|from|join)\s+(?:public\.)?inbound_routes/iu,
    );
    expect(repository).toContain("app.create_telegram_inbound_route");
    expect(repository).toContain("app.rotate_telegram_inbound_route");
    expect(repository).toContain("app.disable_telegram_inbound_route");
  });
});
