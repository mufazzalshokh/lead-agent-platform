import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer } from "node:tls";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createIdentityDatabaseRuntimeConfig } from "../../packages/config/src/index.js";
import { createSessionConnectionProbe } from "../../packages/database/src/runtime/session-connection-probe.js";
import {
  SessionDatabaseError,
  readSessionDatabaseCause,
} from "../../packages/database/src/runtime/session.js";

// The TLS endpoint deliberately ends before PG authentication. These are real
// pg/TLS handshake and certificate-rejection tests, not database behavior proof.
describe("S22 end-to-end encrypted relay", () => {
  it.each(["postgres", "direct"])(
    "preserves trusted DNS SNI/CA and rejects untrusted certificates (%s negotiation)",
    async (negotiation) => {
      const directory = await mkdtemp(join(tmpdir(), "lead-agent-s22-tls-"));
      const key = join(directory, "synthetic.key");
      const cert = join(directory, "synthetic.crt");
      const gitOpenSsl = "C:\\Program Files\\Git\\usr\\bin\\openssl.exe";
      const openssl =
        process.platform === "win32" && existsSync(gitOpenSsl) ? gitOpenSsl : "openssl";
      const peers: string[] = [];
      const sockets = new Set<Socket>();
      const track = (socket: Socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        socket.on("error", () => socket.destroy());
      };
      let upstream: ReturnType<typeof createServer> | undefined;
      let tls: ReturnType<typeof createTlsServer> | undefined;
      try {
        execFileSync(
          openssl,
          [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=DNS:localhost",
            "-keyout",
            key,
            "-out",
            cert,
          ],
          { stdio: "ignore", timeout: 10000 },
        );
        tls = createTlsServer(
          { key: await readFile(key), cert: await readFile(cert), ALPNProtocols: ["postgresql"] },
          (socket) => {
            track(socket);
            peers.push(socket.servername || "none");
            socket.end();
          },
        );
        tls.on("tlsClientError", (_error, socket) => socket.destroy());
        const tlsEndpoint = tls;
        upstream = createServer((socket) => {
          track(socket);
          if (negotiation === "direct") {
            tlsEndpoint.emit("connection", socket);
            return;
          }
          socket.once("data", (request: Buffer) => {
            if (request.length !== 8 || request.readInt32BE(4) !== 80877103) {
              socket.destroy();
              return;
            }
            socket.write("S", () => tlsEndpoint.emit("connection", socket));
          });
        });
        await new Promise<void>((resolve) => upstream?.listen(0, "127.0.0.1", resolve));
        const address = upstream.address();
        if (address === null || typeof address === "string")
          throw new Error("Invalid TLS test listener");
        const url = new URL(`postgres://lead_agent_auth:synthetic@localhost:${address.port}/test`);
        url.searchParams.set("sslmode", "verify-full");
        url.searchParams.set("sslnegotiation", negotiation);
        url.searchParams.set("sslrootcert", cert);
        const configuration = createIdentityDatabaseRuntimeConfig({
          connectionString: url.toString(),
          connectionTimeoutMilliseconds: 5000,
        });
        const normal = new Client({
          connectionString: configuration.connectionString,
          connectionTimeoutMillis: 5000,
        });
        try {
          await expect(normal.connect()).rejects.toThrow("Connection terminated unexpectedly");
        } finally {
          await normal.end();
        }
        expect(peers).toEqual(["localhost"]);
        const probe = await createSessionConnectionProbe(
          configuration,
          {
            onUnexpectedPoolError: () => {
              throw new Error("Unexpected TLS probe pool error");
            },
          },
          {},
        );
        try {
          await expect(probe.resolveSession(Buffer.alloc(32), () => false)).rejects.toThrow(
            "Session database operation failed",
          );
        } finally {
          await probe.close();
        }
        expect(peers).toEqual(["localhost", "localhost"]);
        url.searchParams.delete("sslrootcert");
        const untrusted = await createSessionConnectionProbe(
          createIdentityDatabaseRuntimeConfig({
            connectionString: url.toString(),
            connectionTimeoutMilliseconds: 5000,
          }),
          { onUnexpectedPoolError: () => undefined },
          {},
        );
        try {
          await untrusted
            .resolveSession(Buffer.alloc(32), () => false)
            .then(
              () => {
                throw new Error("Untrusted certificate was accepted");
              },
              (error: unknown) => {
                expect(error).toBeInstanceOf(SessionDatabaseError);
                if (!(error instanceof SessionDatabaseError)) throw error;
                expect(readSessionDatabaseCause(error)).toMatchObject({
                  code: "DEPTH_ZERO_SELF_SIGNED_CERT",
                });
              },
            );
        } finally {
          await untrusted.close();
        }
        expect(peers).toEqual(["localhost", "localhost"]);
      } finally {
        for (const socket of sockets) socket.destroy();
        if (upstream !== undefined)
          await new Promise<void>((resolve) => upstream?.close(() => resolve()));
        tls?.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
    30000,
  );
});
