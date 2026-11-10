/**
 * Entry point for `pnpm --filter @sin/api run db:rls -- status|enable|disable` (Spec 21.1 AC39). The logic lives in
 * `src/db/` so it compiles into `dist/` and runs in the Docker image as `node apps/api/dist/db/rls-cli.js`.
 */
import { main } from "../src/db/rls-cli.js";

process.exitCode = await main(process.argv.slice(2), process.env);
