/**
 * Entry point for `pnpm --filter @sin/api run seed:catalog` (Spec 03.1 §6.3).
 * The implementation lives in `src/seed/` so it compiles into `dist/` and is
 * runnable in the Docker image as `node apps/api/dist/seed/cli.js`.
 *
 * Deliberately NOT registered as Prisma's `prisma.seed` hook: a dev
 * `prisma migrate reset` must never run it silently.
 */
import { main } from "../src/seed/cli.js";

process.exitCode = await main(process.argv.slice(2), process.env);
