import type { FastifyInstance } from "fastify";
import { buildApp, type BuildAppDeps } from "../../src/app.js";
import { loadConfig, type Config } from "../../src/config.js";
import type { TokenVerifier } from "../../src/auth/verify.js";
import {
  FakeExerciseRepository,
  FakeUserRepository,
  authContext,
  fakeVerifier,
} from "./fakes.js";

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgresql://u:p@localhost:5432/sin",
  AUTH0_ISSUER: "https://si-staging.us.auth0.com/",
  AUTH0_AUDIENCE: "https://api.strengthinnumbers.app",
  AUTH0_CLAIM_NAMESPACE: "https://strengthinnumbers.app/",
  WEB_ORIGIN: "http://localhost:5173,https://app.example.com",
};

export const testConfig = (): Config => loadConfig({ ...TEST_ENV });

export interface TestAppOptions {
  config?: Config;
  tokenVerifier?: TokenVerifier;
  userRepository?: FakeUserRepository;
  exerciseRepository?: FakeExerciseRepository;
  checkReadiness?: () => Promise<void>;
  readinessTtlMs?: number;
}

export async function buildTestApp(opts: TestAppOptions = {}): Promise<{
  app: FastifyInstance;
  repo: FakeUserRepository;
  exerciseRepo: FakeExerciseRepository;
}> {
  const repo = opts.userRepository ?? new FakeUserRepository();
  const exerciseRepo = opts.exerciseRepository ?? new FakeExerciseRepository();
  const deps: BuildAppDeps = {
    config: opts.config ?? testConfig(),
    logger: false,
    checkReadiness: opts.checkReadiness ?? (async () => {}),
    readinessTtlMs: opts.readinessTtlMs,
    tokenVerifier: opts.tokenVerifier ?? fakeVerifier(() => authContext()),
    userRepository: repo,
    exerciseRepository: exerciseRepo,
  };
  const app = await buildApp(deps);
  return { app, repo, exerciseRepo };
}
