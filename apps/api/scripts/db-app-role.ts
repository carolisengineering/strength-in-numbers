/**
 * Entry point for `pnpm --filter @sin/api run db:app-role` (Spec 21.1 AC29). The logic lives in `src/db/` so it compiles
 * into `dist/` and runs in the Docker image as `node apps/api/dist/db/app-role-cli.js` (compose has no tsx at runtime).
 */
import { main } from "../src/db/app-role-cli.js";

process.exitCode = await main(process.argv.slice(2), process.env);
