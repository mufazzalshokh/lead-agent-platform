import { createHash, randomBytes } from "node:crypto";

import { WidgetRateLimitError } from "./errors.js";

type Bucket = { count: number; expiresAt: number };

export type WidgetRateLimiter = Readonly<{
  consume(keyParts: readonly string[], limit: number, windowSeconds?: number): void;
  size(): number;
}>;

export const createWidgetRateLimiter = (
  options: Readonly<{
    clock?: () => Date;
    maximumBuckets?: number;
    salt?: Uint8Array;
  }> = {},
): WidgetRateLimiter => {
  const clock = options.clock ?? (() => new Date());
  const maximumBuckets = options.maximumBuckets ?? 10_000;
  if (!Number.isSafeInteger(maximumBuckets) || maximumBuckets < 1)
    throw new TypeError("Invalid bucket bound");
  const salt = options.salt ?? randomBytes(32);
  const buckets = new Map<string, Bucket>();
  const digest = (parts: readonly string[]) =>
    createHash("sha256")
      .update(salt)
      .update("\0" + parts.join("\0"), "utf8")
      .digest("base64url");
  const removeExpired = (now: number): void => {
    for (const [key, bucket] of buckets) if (bucket.expiresAt <= now) buckets.delete(key);
  };
  return Object.freeze({
    consume: (keyParts, limit, windowSeconds = 60) => {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        !Number.isSafeInteger(windowSeconds) ||
        windowSeconds < 1
      ) {
        throw new TypeError("Invalid rate limit");
      }
      const now = clock().getTime();
      removeExpired(now);
      const key = digest(keyParts);
      const current = buckets.get(key);
      if (current === undefined || current.expiresAt <= now) {
        while (buckets.size >= maximumBuckets) {
          buckets.delete(buckets.keys().next().value as string);
        }
        buckets.set(key, { count: 1, expiresAt: now + windowSeconds * 1_000 });
        return;
      }
      if (current.count >= limit) {
        throw new WidgetRateLimitError(Math.max(1, Math.ceil((current.expiresAt - now) / 1_000)));
      }
      current.count += 1;
    },
    size: () => buckets.size,
  });
};
