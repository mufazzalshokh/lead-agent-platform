import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export const runMigrations = async (pool: Pool): Promise<void> => {
  await migrate(drizzle(pool), { migrationsFolder });
};
