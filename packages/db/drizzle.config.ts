import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://emergency_trial:emergency_trial@localhost:5432/emergency_trial",
  },
  strict: true,
  verbose: true,
});
