import { URL } from "node:url";

import { ConfigurationValidationError } from "./database.js";

const BOT_TOKEN_PATTERN = /^[1-9][0-9]{4,19}:[A-Za-z0-9_-]{20,128}$/u;
const BOT_USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{4,31}$/u;
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{43,256}$/u;

export type TelegramPlatformConfig = Readonly<{
  apiBaseUrl: "https://api.telegram.org";
  botToken: string;
  botUsername: string;
  requestTimeoutMilliseconds: number;
  webhookSecret: string;
  webhookUrl: string;
}>;

const required = (value: unknown, key: string, pattern: RegExp): string => {
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new ConfigurationValidationError(key);
  }
  return value;
};

const webhookUrl = (value: unknown): string => {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new ConfigurationValidationError("TELEGRAM_WEBHOOK_URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationValidationError("TELEGRAM_WEBHOOK_URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/v1/webhooks/telegram"
  ) {
    throw new ConfigurationValidationError("TELEGRAM_WEBHOOK_URL");
  }
  return value;
};

export const loadTelegramPlatformConfig = (
  environment: NodeJS.ProcessEnv,
): TelegramPlatformConfig =>
  Object.freeze({
    apiBaseUrl: "https://api.telegram.org" as const,
    botToken: required(environment["TELEGRAM_BOT_TOKEN"], "TELEGRAM_BOT_TOKEN", BOT_TOKEN_PATTERN),
    botUsername: required(
      environment["TELEGRAM_BOT_USERNAME"],
      "TELEGRAM_BOT_USERNAME",
      BOT_USERNAME_PATTERN,
    ),
    requestTimeoutMilliseconds: 10_000,
    webhookSecret: required(
      environment["TELEGRAM_WEBHOOK_SECRET"],
      "TELEGRAM_WEBHOOK_SECRET",
      WEBHOOK_SECRET_PATTERN,
    ),
    webhookUrl: webhookUrl(environment["TELEGRAM_WEBHOOK_URL"]),
  });
