import { createApi } from "./app.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;

const parsePort = (value: string | undefined): number => {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError("PORT must be an integer between 1 and 65535");
  }

  return port;
};

const start = async (): Promise<void> => {
  const api = createApi();
  const host = process.env["HOST"]?.trim() || DEFAULT_HOST;
  const port = parsePort(process.env["PORT"]);

  await api.listen({ host, port });
};

start().catch((error: unknown) => {
  console.error("API startup failed", error);
  process.exitCode = 1;
});
