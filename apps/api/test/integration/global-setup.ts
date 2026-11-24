import { execFileSync } from "node:child_process";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { setAppRoleLogin } from "../../src/db/app-role.js";
import { SHARED_PG_ENV, TEMPLATE_DB, TEST_APP_PASSWORD, shouldRunIntegration } from "./helpers.js";
import { POSTGRES_IMAGE } from "./postgres-image.js";

/**
 * Issue 361 — one Postgres for the whole integration run. It is migrated once, into a template database, and
 * `startIntegrationDb` copies that template for each test file (`helpers.ts`). The server's address reaches the
 * workers through the environment: this runs in the main process before any worker starts, and a worker inherits
 * the environment it is started with.
 *
 * Without `RUN_INTEGRATION=1` nothing is started, so the suite still self-skips on a machine without Docker.
 */
export default async function setup(): Promise<() => Promise<void>> {
  if (!shouldRunIntegration()) return async () => undefined;

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("postgres")
    // Every worker holds a superuser and an app pool per file; the default 100 connections isn't enough for all of them.
    .withCommand(["postgres", "-c", "max_connections=500"])
    .start();
  const adminUrl = container.getConnectionUri();
  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEMPLATE_DB}"`);
    const templateUrl = new URL(adminUrl);
    templateUrl.pathname = `/${TEMPLATE_DB}`;
    // The real migrations, exactly as Render's pre-deploy step applies them.
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: templateUrl.toString() },
      stdio: "inherit",
    });
    const template = new PrismaClient({ datasourceUrl: templateUrl.toString() });
    try {
      // `sin_app` is a role of the whole server: its login is set once here, for every copy.
      await setAppRoleLogin(template, TEST_APP_PASSWORD);
    } finally {
      await template.$disconnect();
    }
    // A template can only be copied while nothing is connected to it; refusing connections keeps it that way.
    await admin.$executeRawUnsafe(`ALTER DATABASE "${TEMPLATE_DB}" WITH ALLOW_CONNECTIONS false`);
  } catch (err) {
    await admin.$disconnect();
    await container.stop();
    throw err;
  }
  await admin.$disconnect();
  process.env[SHARED_PG_ENV] = adminUrl;

  return async () => {
    delete process.env[SHARED_PG_ENV];
    await container.stop();
  };
}
