/**
 * Entry point for `pnpm --filter @sin/api run records:rebuild` (Spec 07.0 §6.5).
 * The logic lives in `src/records/` so it compiles into `dist/` and runs in the
 * Docker image as `node apps/api/dist/records/cli.js`.
 *
 * Deliberately NOT a Prisma hook: like the catalog seed, a dev
 * `prisma migrate reset` must never run it silently.
 */
import { main } from "../src/records/cli.js";

process.exitCode = await main(process.argv.slice(2), process.env);
