import { createServer, createConnection, isIP, type Socket } from "node:net";
import type { IdentityDatabaseRuntimeConfig } from "@lead-agent/config";
import type { PoolConfig } from "pg";
import type { AuthenticatedApplicationSession } from "@lead-agent/security";
import { parseIntoClientConfig } from "pg-connection-string";

import {
  createSessionRuntimeForOwnedTransport,
  type SessionDatabaseRuntimeObservability,
} from "./session.js";

export class SessionConnectionProbeUnavailableError extends Error {
  constructor() {
    super("Session connection probe unavailable");
    this.name = "SessionConnectionProbeUnavailableError";
  }
}

// Use the installed public parser rather than private pg fields or a second SSL
// parser. The only endpoint accepted from outside this module is trusted config.
export const sessionProbePoolConfig = (
  configuration: IdentityDatabaseRuntimeConfig,
  relayPort: number,
  environment: NodeJS.ProcessEnv,
): Readonly<{ pool: PoolConfig; upstream: Readonly<{ host: string; port: number }> }> => {
  if (
    !Number.isInteger(relayPort) ||
    relayPort < 1 ||
    relayPort > 65535 ||
    Object.keys({ ...process.env, ...environment }).some(
      (key) =>
        key.startsWith("PG") && (environment[key] !== undefined || process.env[key] !== undefined),
    )
  ) {
    throw new SessionConnectionProbeUnavailableError();
  }
  const parsed = parseIntoClientConfig(configuration.connectionString);
  const host = parsed.host;
  const port = parsed.port ?? 5432;
  // No Unix sockets, URI host overrides, multi-host routing or inherited pg env.
  if (
    host === undefined ||
    host.length === 0 ||
    host.includes("/") ||
    host.includes(",") ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    parsed.connectionString !== undefined
  ) {
    throw new SessionConnectionProbeUnavailableError();
  }
  let ssl = parsed.ssl ?? false;
  if (ssl !== false) {
    const options = ssl === true ? {} : ssl;
    // pg overwrites servername for a DNS destination but not for an IP. Preserve
    // precisely those semantics after substituting an IP loopback destination.
    ssl = isIP(host) === 0 ? { ...options, servername: host } : { ...options };
  }
  return Object.freeze({
    upstream: Object.freeze({ host, port }),
    pool: {
      ...parsed,
      connectionString: undefined,
      host: "127.0.0.1",
      port: relayPort,
      ssl,
      max: 1,
      connectionTimeoutMillis: configuration.connectionTimeoutMilliseconds,
      idleTimeoutMillis: configuration.idleTimeoutMilliseconds,
      statement_timeout: configuration.statementTimeoutMilliseconds,
    },
  });
};

export type SessionConnectionProbe = Readonly<{
  resolveSession: (
    hash: Uint8Array,
    shouldCut: () => boolean,
  ) => Promise<AuthenticatedApplicationSession | null>;
  close: () => Promise<void>;
}>;

/** One owned listener, one request-scoped pool, no shared pool access. */
export const createSessionConnectionProbe = async (
  configuration: IdentityDatabaseRuntimeConfig,
  observability: SessionDatabaseRuntimeObservability,
  environment: NodeJS.ProcessEnv,
): Promise<SessionConnectionProbe> => {
  let closed = false;
  let active: Readonly<{ shouldCut: () => boolean }> | null = null;
  let accepted = false;
  const sockets = new Set<Socket>();
  const track = (socket: Socket): Socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    return socket;
  };
  // Parse/validate before opening a listener, never connect upstream at startup.
  const initial = sessionProbePoolConfig(configuration, 1, environment);
  const server = createServer((incoming) => {
    track(incoming);
    incoming.on("error", () => incoming.destroy());
    const attempt = active;
    if (closed || attempt === null || accepted) {
      incoming.destroy();
      return;
    }
    accepted = true;
    // Re-evaluate at accept time, not the earlier request's phase snapshot.
    let upstream: Socket;
    try {
      if (attempt.shouldCut()) {
        incoming.destroy();
        return;
      }
      upstream = track(createConnection(initial.upstream));
    } catch {
      incoming.destroy();
      observability.onUnexpectedPoolError(new SessionConnectionProbeUnavailableError());
      return;
    }
    upstream.on("error", () => {
      incoming.destroy();
      upstream.destroy();
    });
    incoming.on("close", () => upstream.destroy());
    upstream.on("close", () => incoming.destroy());
    incoming.pipe(upstream).pipe(incoming);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  server.on("error", () => {
    closed = true;
    for (const socket of sockets) socket.destroy();
    observability.onUnexpectedPoolError(new SessionConnectionProbeUnavailableError());
  });
  server.unref();
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new SessionConnectionProbeUnavailableError();
  }
  const poolConfiguration = sessionProbePoolConfig(configuration, address.port, environment).pool;
  let closing: Promise<void> | undefined;
  return Object.freeze({
    resolveSession: async (hash: Uint8Array, shouldCut: () => boolean) => {
      if (closed || active !== null) throw new SessionConnectionProbeUnavailableError();
      const attempt = Object.freeze({ shouldCut });
      active = attempt;
      accepted = false;
      const runtime = createSessionRuntimeForOwnedTransport(poolConfiguration, observability);
      // This is owned-socket disposal, not an assumed cancellation by the browser.
      const deadline = setTimeout(() => {
        for (const socket of sockets) socket.destroy();
      }, 15_000);
      deadline.unref();
      try {
        return await runtime.resolveSession(hash);
      } finally {
        clearTimeout(deadline);
        for (const socket of sockets) socket.destroy();
        await runtime.close();
        if (active === attempt) active = null;
      }
    },
    close: () => {
      if (closing !== undefined) return closing;
      closed = true;
      for (const socket of sockets) socket.destroy();
      closing = new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(new SessionConnectionProbeUnavailableError()),
        );
      });
      return closing;
    },
  });
};
