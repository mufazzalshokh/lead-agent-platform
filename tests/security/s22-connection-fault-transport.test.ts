import { createServer, type Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createIdentityDatabaseRuntimeConfig } from "../../packages/config/src/index.js";
import { SessionDatabaseError } from "../../packages/database/src/runtime/session.js";
import {
  createSessionConnectionProbe,
  sessionProbePoolConfig,
} from "../../packages/database/src/runtime/session-connection-probe.js";

const config = (
  connectionString = "postgres://lead_agent_auth:synthetic@localhost:5432/test?sslmode=disable",
) =>
  createIdentityDatabaseRuntimeConfig({
    connectionString,
    connectionTimeoutMilliseconds: 500,
    statementTimeoutMilliseconds: 500,
  });

describe("S22 owned loopback transport", () => {
  it("bounds concurrency and disposes owned sockets during an unfinished connection", async () => {
    const sockets = new Set<Socket>();
    let accepted: () => void = () => undefined;
    const connected = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const upstream = createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => socket.destroy());
      socket.on("close", () => sockets.delete(socket));
      accepted();
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (address === null || typeof address === "string") throw new Error("Invalid test listener");
    const probe = await createSessionConnectionProbe(
      config(`postgres://a:b@127.0.0.1:${address.port}/test?sslmode=disable`),
      { onUnexpectedPoolError: () => undefined },
      {},
    );
    const pending = probe.resolveSession(Buffer.alloc(32), () => false);
    // Attach the rejection handler before triggering close, avoiding a floating rejection.
    const rejected = expect(pending).rejects.toBeInstanceOf(SessionDatabaseError);
    try {
      await connected;
      await expect(probe.resolveSession(Buffer.alloc(32), () => true)).rejects.toThrow(
        "Session connection probe unavailable",
      );
      await probe.close();
      await rejected;
      await expect(probe.resolveSession(Buffer.alloc(32), () => true)).rejects.toThrow(
        "Session connection probe unavailable",
      );
    } finally {
      await probe.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
  it("uses a fresh real pg connection on every probe; cutting forwards no bytes or upstream connection", async () => {
    let connections = 0;
    const sockets = new Set<Socket>();
    const upstream = createServer((socket) => {
      connections++;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      socket.once("data", () => socket.end());
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (address === null || typeof address === "string") throw new Error("Invalid test listener");
    const observe = vi.fn();
    const probe = await createSessionConnectionProbe(
      config(`postgres://lead_agent_auth:synthetic@127.0.0.1:${address.port}/test?sslmode=disable`),
      { onUnexpectedPoolError: observe },
      {},
    );
    try {
      await expect(probe.resolveSession(Buffer.alloc(32), () => false)).rejects.toBeInstanceOf(
        SessionDatabaseError,
      );
      expect(connections).toBe(1);
      await expect(
        probe.resolveSession(Buffer.alloc(32), () => {
          throw new Error("private-predicate-failure");
        }),
      ).rejects.toBeInstanceOf(SessionDatabaseError);
      expect(connections).toBe(1);
      expect(observe).toHaveBeenCalledOnce();
      expect(JSON.stringify(observe.mock.calls)).not.toContain("private-predicate-failure");
      observe.mockClear();
      await expect(probe.resolveSession(Buffer.alloc(32), () => true)).rejects.toBeInstanceOf(
        SessionDatabaseError,
      );
      expect(connections).toBe(1);
      await expect(probe.resolveSession(Buffer.alloc(32), () => false)).rejects.toBeInstanceOf(
        SessionDatabaseError,
      );
      expect(connections).toBe(2);
      expect(observe).not.toHaveBeenCalled();
    } finally {
      await probe.close();
      await probe.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
  it("preserves explicit SSL/CA/SNI configuration and removes any DSN override", () => {
    const original = config(
      "postgres://lead_agent_auth:synthetic@database.example.test:5433/test?sslmode=verify-full&application_name=s22&options=-c%20timezone%3DUTC",
    );
    const result = sessionProbePoolConfig(original, 12345, {});
    expect(result.upstream).toEqual({ host: "database.example.test", port: 5433 });
    expect(result.pool).toMatchObject({
      host: "127.0.0.1",
      port: 12345,
      user: "lead_agent_auth",
      password: "synthetic",
      database: "test",
      max: 1,
      connectionTimeoutMillis: 500,
      statement_timeout: 500,
      application_name: "s22",
      options: "-c timezone=UTC",
      ssl: { servername: "database.example.test" },
    });
    expect(result.pool.connectionString).toBeUndefined();
    expect(result.pool.ssl).not.toMatchObject({ rejectUnauthorized: false });
  });
  it.each(["PGHOST", "PGPASSWORD", "PGSSLNEGOTIATION", "PGOPTIONS"])(
    "rejects ambient %s instead of silently changing destination/verification",
    (key) => {
      expect(() => sessionProbePoolConfig(config(), 12345, { [key]: "conflicting" })).toThrow(
        "Session connection probe unavailable",
      );
    },
  );
  it("also checks actual process pg environment rather than trusting only an injected environment object", () => {
    vi.stubEnv("PGHOST", "conflicting");
    try {
      expect(() => sessionProbePoolConfig(config(), 12345, {})).toThrow(
        "Session connection probe unavailable",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("keeps IP-host semantics and explicit disabled SSL without adding SNI", () => {
    expect(
      sessionProbePoolConfig(config("postgres://a:b@192.0.2.1/test?sslmode=verify-full"), 12345, {})
        .pool.ssl,
    ).not.toHaveProperty("servername");
    expect(sessionProbePoolConfig(config(), 12345, {}).pool.ssl).toBe(false);
  });
  it.each([0, 65536, 1.5])("rejects invalid relay port %s", (port) => {
    expect(() => sessionProbePoolConfig(config(), port, {})).toThrow(
      "Session connection probe unavailable",
    );
  });
});
