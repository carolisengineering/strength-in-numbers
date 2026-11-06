import { describe, expect, it } from "vitest";
import { cleanupAccount, cleanupAll } from "../src/node/cleanup.ts";
import { FakeApi } from "./fake-api.ts";

const id = (n: number) => `0190f6c2-3333-7000-8000-${String(n).padStart(12, "0")}`;

function accountWith(finished: number, live: boolean): FakeApi {
  const api = new FakeApi();
  for (let i = 1; i <= finished; i += 1) api.workouts.push({ id: id(i), live: false });
  if (live) api.workouts.push({ id: id(99), live: true });
  api.routines.push({ id: "0190f6c2-2222-7000-8000-000000000001", name: "Load test — strength session" });
  return api;
}

describe("AC15 — cleanup leaves the accounts empty", () => {
  it("deletes the live workout and every page of history, and leaves the routine", async () => {
    const api = accountWith(5, true);
    expect(await cleanupAccount(api)).toBe(6);
    expect(api.workouts).toEqual([]);
    expect(api.routines).toHaveLength(1);
    expect(api.calls.some((c) => c.includes("/v1/routines"))).toBe(false);
    expect(api.calls.filter((c) => c.startsWith("GET /v1/workouts?")).length).toBeGreaterThan(1);
  });

  it("a second run is a no-op", async () => {
    const api = accountWith(3, false);
    await cleanupAccount(api);
    api.calls = [];
    expect(await cleanupAccount(api)).toBe(0);
    expect(api.calls.some((c) => c.startsWith("DELETE"))).toBe(false);
  });

  it("tolerates a 404 on delete", async () => {
    const api = accountWith(3, false);
    api.goneOnDelete.add(id(2));
    expect(await cleanupAccount(api)).toBe(3);
    expect(api.workouts).toEqual([]);
  });

  it("cleanupAll touches only the accounts it was given, paced one at a time", async () => {
    const mine = [accountWith(2, false), accountWith(1, true)];
    const other = accountWith(4, false);
    const paced: number[] = [];
    const result = await cleanupAll(mine, { pace: async (i) => void paced.push(i) });
    expect(result).toEqual({ removed: 4 });
    expect(other.calls).toEqual([]);
    expect(other.workouts).toHaveLength(4);
    expect(paced).toEqual([0, 1]);
  });
});
