/**
 * Spec 16 — how the CLI hands each lifter to k6. Pure; k6 loads it (relative imports only, AC1).
 *
 * Minor 367: one environment variable per lifter, not one for all of them. Linux caps a single environment string
 * at 128 KiB, and 150 Auth0 tokens in one variable would pass that, so k6 would fail to start. Each variable holds
 * one token (in memory only, never logged; AC22).
 */

export interface LifterInput {
  token: string;
  routineId: string;
}

const COUNT = "LOADTEST_LIFTER_COUNT";
const lifterKey = (i: number): string => `LOADTEST_LIFTER_${i}`;

/** `LOADTEST_LIFTER_COUNT` plus `LOADTEST_LIFTER_<i>` = `{ token, routineId }` for each lifter, from 0. */
export function lifterEnv(lifters: readonly LifterInput[]): Record<string, string> {
  const env: Record<string, string> = { [COUNT]: String(lifters.length) };
  lifters.forEach(({ token, routineId }, i) => {
    env[lifterKey(i)] = JSON.stringify({ token, routineId });
  });
  return env;
}

/** Minor 365 — this run's nonce: its start time in milliseconds, kept to 32 bits for the seeded generator. */
export function runNonce(at: Date): number {
  return at.getTime() >>> 0;
}

/**
 * A lifter's two seeds for one session. `plan` (rests, join point, burst offset) depends only on the lifter and the
 * iteration, so a plan is reproducible (AC2). `payload` (client ids, reps, weights) also mixes in the run's nonce,
 * so a run never resends the last run's client ids, which the API would replay as the old workout (minor 365).
 * Multiplying by an odd constant and XOR-ing one nonce is one-to-one mod 2^32, so lifters in a run never share it.
 */
export function lifterSeeds(index: number, iteration: number, nonce: number): { plan: number; payload: number } {
  const plan = (index + 1) * 100_003 + iteration;
  return { plan, payload: (Math.imul(plan, 0x9e3779b1) ^ nonce) >>> 0 };
}

/** The lifters `lifterEnv` wrote. A missing variable is named, never a value (it would hold a token). */
export function readLifters(env: Record<string, string | undefined>): LifterInput[] {
  const count = Number(env[COUNT] ?? "0");
  return Array.from({ length: count }, (_, i) => {
    const value = env[lifterKey(i)];
    if (value === undefined) throw new Error(`missing ${lifterKey(i)} (lifter ${i + 1} of ${count})`);
    const { token, routineId } = JSON.parse(value) as LifterInput;
    return { token, routineId };
  });
}
