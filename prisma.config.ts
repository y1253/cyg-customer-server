import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

// The schema and migrations live in the shared `cyg-db` repo (github.com/y1253/cyg-db),
// the SAME database the internal API uses. CYG_DB_DIR points at its checkout; a relative path
// resolves against this server's root, so moving the checkout is a one-line .env edit.
//
// ⚠️ The schema is COPIED to prisma/schema.prisma (gitignored) on every Prisma command
// rather than referenced in place. Prisma resolves @prisma/client from the SCHEMA's
// directory, so a schema outside this package makes `prisma generate` auto-install
// prisma into the nearest common ancestor directory and generate the client THERE —
// not into this server's node_modules. Edit the schema in cyg-db, never the copy.
//
// ⚠️ Never run `prisma db push` / `migrate` from here. Schema changes are applied once,
// from the internal server; this side only runs `prisma generate`.
const dbDir = path.resolve(__dirname, process.env.CYG_DB_DIR || "../../db");
const source = path.join(dbDir, "schema.prisma");
const copy = path.join(__dirname, "prisma", "schema.prisma");

if (!fs.existsSync(source)) {
  throw new Error(
    `cyg-db schema not found at ${source}. Clone github.com/y1253/cyg-db and set CYG_DB_DIR in .env.`,
  );
}
const banner = `// GENERATED from ${source} by prisma.config.ts. Edit it in cyg-db, never here.\n`;
const next = banner + fs.readFileSync(source, "utf8");
if (!fs.existsSync(copy) || fs.readFileSync(copy, "utf8") !== next) {
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.writeFileSync(copy, next);
}

export default defineConfig({
  schema: copy,
  engine: "classic",
  migrations: {
    path: path.join(dbDir, "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
