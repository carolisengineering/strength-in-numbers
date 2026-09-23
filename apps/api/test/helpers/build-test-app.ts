import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { buildApp, type BuildAppDeps } from "../../src/app.js";
import { loadConfig, type Config } from "../../src/config.js";
import type { TokenVerifier } from "../../src/auth/verify.js";
import type { ExerciseRepository } from "../../src/repositories/exercise.js";
import type { WorkoutRepository } from "../../src/repositories/workout.js";
import {
  FakeExerciseRepository,
  FakeUserRepository,
  FakeWorkoutRepository,
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

export interface TestAppOptions<
  R extends ExerciseRepository = FakeExerciseRepository,
  W extends WorkoutRepository = FakeWorkoutRepository,
> {
  config?: Config;
  tokenVerifier?: TokenVerifier;
  userRepository?: FakeUserRepository;
  /** Defaults to a fake; integration tests pass the real repository. */
  exerciseRepository?: R;
  /** Defaults to a fake; integration tests pass the real repository. */
  workoutRepository?: W;
  logger?: FastifyBaseLogger | boolean;
  checkReadiness?: () => Promise<void>;
  readinessTtlMs?: number;
}

export async function buildTestApp<
  R extends ExerciseRepository = FakeExerciseRepository,
  W extends WorkoutRepository = FakeWorkoutRepository,
>(
  opts: TestAppOptions<R, W> = {},
): Promise<{
  app: FastifyInstance;
  repo: FakeUserRepository;
  exerciseRepo: R;
  workoutRepo: W;
}> {
  const repo = opts.userRepository ?? new FakeUserRepository();
  const exerciseRepo = (opts.exerciseRepository ??
    new FakeExerciseRepository()) as R;
  const workoutRepo = (opts.workoutRepository ??
    new FakeWorkoutRepository(exerciseRepo)) as W;
  const deps: BuildAppDeps = {
    config: opts.config ?? testConfig(),
    logger: opts.logger ?? false,
    checkReadiness: opts.checkReadiness ?? (async () => {}),
    readinessTtlMs: opts.readinessTtlMs,
    tokenVerifier: opts.tokenVerifier ?? fakeVerifier(() => authContext()),
    userRepository: repo,
    exerciseRepository: exerciseRepo,
    workoutRepository: workoutRepo,
  };
  const app = await buildApp(deps);
  return { app, repo, exerciseRepo, workoutRepo };
}
