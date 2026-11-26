import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { MIGRATIONS_FOLDER } from "./src/db/migrator.js";

export default defineConfig({
  out: MIGRATIONS_FOLDER,
  schema: "./src/db/schema",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
