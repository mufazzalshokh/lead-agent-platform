import { describe, expect, it, vi } from "vitest";
import { createIdentityDatabaseRuntimeConfig } from "../../packages/config/src/index.js";
import { createS22SessionProbe } from "../../apps/api/src/diagnostics/s22-connection-fault.js";
import { probeProfile } from "./s22-connection-fault-fixtures.js";
import { NOW, staffSession } from "../telegram/fixtures.js";

describe("S22 connection-fault disabled/failed initialization", () => {
  it("leaves normal authentication intact and emits only sanitized NOT_ADMITTED receipts", async () => {
    const profile = probeProfile();
    const report = vi.fn();
    const probe = createS22SessionProbe(
      profile,
      createIdentityDatabaseRuntimeConfig({
        connectionString: "postgres://lead_agent_auth:synthetic@127.0.0.1/test?sslmode=disable",
      }),
      { PGHOST: "conflicting-private-host" },
      report,
      { wall: () => NOW.getTime(), monotonic: () => 0 },
    );
    const normal = vi.fn(() => Promise.resolve(staffSession));
    const metadata = vi.fn();
    await probe.start();
    try {
      expect(
        await probe.resolveSession(
          "private-context-not-to-log",
          "private-token-not-to-log",
          normal,
          metadata,
        ),
      ).toBe(staffSession);
      expect(normal).toHaveBeenCalledOnce();
      expect(metadata).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalledTimes(2);
      for (const [receipt] of report.mock.calls)
        expect(receipt).toMatchObject({ outcome: "not_admitted", connection_cut: false });
      expect(JSON.stringify(report.mock.calls)).not.toMatch(
        /private-context|private-token|conflicting-private-host|postgres:\/\//u,
      );
    } finally {
      await probe.close();
    }
  });
});
