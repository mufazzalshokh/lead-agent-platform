import Fastify, { type FastifyInstance } from "fastify";

export const createApi = (): FastifyInstance => {
  const api = Fastify({ logger: false });

  api.get("/health", () => ({
    service: "api",
    status: "ok",
  }));

  return api;
};
