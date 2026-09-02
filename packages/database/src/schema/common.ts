import { sql } from "drizzle-orm";
import { bigint, customType, timestamp } from "drizzle-orm/pg-core";

export type LocaleMap = Partial<Record<"en" | "ru" | "uz", string>>;

export const binary = customType<{ data: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

export const searchVector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const immutableCreatedAt = () =>
  timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .defaultNow()
    .notNull();

export const mutableColumns = () => ({
  createdAt: timestamp("created_at", {
    mode: "date",
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", {
    mode: "date",
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
  version: bigint("version", { mode: "bigint" })
    .default(sql`1`)
    .notNull(),
});
