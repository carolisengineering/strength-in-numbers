/**
 * Emit the OpenAPI 3.1 contract document (Spec 03.0 §6.3, AC5).
 *
 * Builds the app with inert collaborators — no token verifier, no database is
 * touched, only the route *schemas* are read — calls `app.swagger()` once after
 * `ready()`, and writes the result to `<repo root>/openapi.json` with a trailing
 * newline. CI runs this and `git diff --exit-code openapi.json`; a route-schema
 * change that is not re-emitted fails the build.
 *
 *   pnpm --filter @sin/api run openapi:emit
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { TokenVerifier } from "../src/auth/verify.js";
import type { UserRepository } from "../src/repositories/user.js";
import type { ExerciseRepository } from "../src/repositories/exercise.js";

const OUTPUT_PATH = fileURLToPath(new URL("../../../openapi.json", import.meta.url));

// The emit only reads route schemas; these are never invoked.
const inertVerifier: TokenVerifier = {
  verify: () => {
    throw new Error("token verifier is not used during OpenAPI emit");
  },
};
const inertRepository = new Proxy({} as UserRepository, {
  get() {
    throw new Error("user repository is not used during OpenAPI emit");
  },
});
const inertExerciseRepository = new Proxy({} as ExerciseRepository, {
  get() {
    throw new Error("exercise repository is not used during OpenAPI emit");
  },
});

const EMIT_ENV: Record<string, string> = {
  NODE_ENV: "development",
  PORT: "8080",
  DATABASE_URL: "postgresql://emit:emit@localhost:5432/emit",
  AUTH0_ISSUER: "https://emit.example.com/",
  AUTH0_AUDIENCE: "https://api.strengthinnumbers.app",
  AUTH0_CLAIM_NAMESPACE: "https://strengthinnumbers.app/",
  WEB_ORIGIN: "http://localhost:5173",
};

async function main(): Promise<void> {
  const app = await buildApp({
    config: loadConfig(EMIT_ENV),
    logger: false,
    checkReadiness: async () => {},
    tokenVerifier: inertVerifier,
    userRepository: inertRepository,
    exerciseRepository: inertExerciseRepository,
  });
  await app.ready();
  const doc = app.swagger();
  await app.close();

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  process.stdout.write(`wrote ${OUTPUT_PATH}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `openapi:emit failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
