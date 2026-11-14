import { describe, expect, it } from "vitest";
import { lifterEnv, readLifters, type LifterInput } from "../src/plan/lifters.ts";

const ROUTINE = "0190f6c2-2222-7000-8000-000000000001";
const lifters = (n: number, tokenLength = 20): LifterInput[] =>
  Array.from({ length: n }, (_, i) => ({ token: `${"t".repeat(tokenLength)}${i}`, routineId: ROUTINE }));

describe("minor 367 — one variable per lifter", () => {
  it("round-trips the lifters in order", () => {
    const xs = lifters(3);
    expect(readLifters(lifterEnv(xs))).toEqual(xs);
  });

  it("keeps every variable small at 150 Auth0-length tokens", () => {
    const env = lifterEnv(lifters(150, 1200));
    expect(Object.keys(env)).toHaveLength(151);
    for (const [key, value] of Object.entries(env)) expect(Buffer.byteLength(value), key).toBeLessThan(8192);
  });

  it("puts exactly one lifter's token in each variable", () => {
    const xs = lifters(150, 1200);
    const env = lifterEnv(xs);
    for (let i = 0; i < xs.length; i += 1) {
      const value = env[`LOADTEST_LIFTER_${i}`]!;
      expect(JSON.parse(value)).toEqual({ token: xs[i]!.token, routineId: ROUTINE });
      const others = xs.filter((x, j) => j !== i && value.includes(`"${x.token}"`));
      expect(others).toEqual([]);
    }
  });

  it("names the missing variable without printing any token", () => {
    const [first] = lifters(1);
    const env = { LOADTEST_LIFTER_COUNT: "2", LOADTEST_LIFTER_0: JSON.stringify(first) };
    let message = "";
    try {
      readLifters(env);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/missing LOADTEST_LIFTER_1 \(lifter 2 of 2\)/);
    expect(message).not.toContain(first!.token);
  });

  it("reads no lifters from an empty environment", () => {
    expect(readLifters({})).toEqual([]);
  });
});
