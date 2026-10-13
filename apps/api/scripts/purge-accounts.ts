/**
 * Entry point for `pnpm --filter @sin/api run account:purge` (Spec 11 §6.4).
 * The logic lives in `src/account/` so it compiles into `dist/` and runs in
 * the Docker image as `node apps/api/dist/account/purge-cli.js`.
 *
 * Deliberately NOT a Prisma hook: a dev `prisma migrate reset` must never run it.
 */
import { main } from "../src/account/purge-cli.js";

process.exitCode = await main(process.argv.slice(2), process.env);
