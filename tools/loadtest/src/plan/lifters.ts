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

const WHOLE = /^\d+$/;
const NONCE = "LOADTEST_RUN_NONCE";

/**
 * The lifters `lifterEnv` wrote. Minor 580: a missing or bad count refuses to start (k6 outside the CLI would
 * otherwise run every iteration into "no account for lifter i"). Minor 577: a missing, unparseable or incomplete
 * variable is named, never quoted: its value holds a token, and a JSON parse error quotes the start of it.
 */
export function readLifters(env: Record<string, string | undefined>): LifterInput[] {
  const raw = env[COUNT];
  const count = raw !== undefined && WHOLE.test(raw) ? Number(raw) : 0;
  if (count < 1) throw new Error(`${COUNT} is missing or not a whole number of at least 1`);
  return Array.from({ length: count }, (_, i) => {
    const key = lifterKey(i);
    const where = `(lifter ${i + 1} of ${count})`;
    const value = env[key];
    if (value === undefined) throw new Error(`missing ${key} ${where}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`${key} is not valid JSON ${where}`);
    }
    const { token, routineId } = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Partial<Record<keyof LifterInput, unknown>>;
    if (typeof token !== "string" || token === "" || typeof routineId !== "string" || routineId === "") {
      throw new Error(`${key} has no token or routineId ${where}`);
    }
    return { token, routineId };
  });
}

/** Minor 580: this run's nonce as the CLI wrote it; missing or not a 32-bit whole number refuses to start. */
export function readNonce(env: Record<string, string | undefined>): number {
  const raw = env[NONCE];
  const n = raw !== undefined && WHOLE.test(raw) ? Number(raw) : -1;
  if (n < 0 || n > 0xffffffff) throw new Error(`${NONCE} is missing or not a 32-bit whole number`);
  return n;
}
