import { describe, expect, it } from "vitest";
import type { Api, ApiResponse } from "../src/node/api.ts";
import { politeApis } from "../src/node/polite.ts";

/** A fake clock: sleep advances time; each API records the time it was called. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

function scripted(responses: ApiResponse[], calledAt: number[], now: () => number): Api {
  const next = async () => {
    calledAt.push(now());
    return responses.shift() ?? { status: 200, body: {} };
  };
  return { get: next, post: next, patch: next, del: next };
}

describe("final review — the CLI's own requests stay under the API's per-IP limit", () => {
  it("spaces every request across all accounts by the minimum interval", async () => {
    const c = clock();
    const calledAt: number[] = [];
    const [a, b] = politeApis([scripted([], calledAt, c.now), scripted([], calledAt, c.now)], { minIntervalMs: 200, maxRetries: 3, ...c });
    await a!.get("/x");
    await b!.get("/x");
    await a!.del("/x");
    expect(calledAt).toEqual([0, 200, 400]);
  });

  it("a 429 waits for Retry-After, then retries", async () => {
    const c = clock();
    const calledAt: number[] = [];
    const [a] = politeApis([scripted([{ status: 429, body: {}, retryAfterS: 5 }, { status: 204, body: {} }], calledAt, c.now)], {
      minIntervalMs: 200,
      maxRetries: 3,
      ...c,
    });
    expect((await a!.del("/v1/workouts/x")).status).toBe(204);
    expect(calledAt).toEqual([0, 5000]);
  });

  it("without Retry-After it waits a second; after maxRetries it gives back the 429", async () => {
    const c = clock();
    const calledAt: number[] = [];
    const limited = Array.from({ length: 5 }, () => ({ status: 429, body: {} }));
    const [a] = politeApis([scripted(limited, calledAt, c.now)], { minIntervalMs: 200, maxRetries: 2, ...c });
    expect((await a!.get("/v1/workouts?limit=50")).status).toBe(429);
    expect(calledAt).toEqual([0, 1000, 2000]);
  });
});
