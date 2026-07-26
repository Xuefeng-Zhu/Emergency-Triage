import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ??
  process.env.DATABASE_URL_DOCKER ??
  "postgresql://emergency_trial:emergency_trial@localhost:5432/emergency_trial";

export const pool = new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });
