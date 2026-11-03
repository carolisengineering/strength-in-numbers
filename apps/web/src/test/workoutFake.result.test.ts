import type { SectionTimer } from "@sin/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../config";
import { API_BASE_URL, stubWebEnv } from "./catalogHarness";
import { server } from "./msw/server";
import { createWorkoutFake } from "./workoutFake";
import { makeWorkoutDetail } from "./workoutFixtures";

beforeEach(() => stubWebEnv());
afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${API_BASE_URL}/v1${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : undefined };
};
const slugOf = (json: Record<string, unknown> | undefined) => new URL(String(json!["type"])).pathname.split("/").pop();
const errorPaths = (json: Record<string, unknown> | undefined) => (json!["errors"] as { path: string }[]).map((e) => e.path);

function boot(timer: SectionTimer | null, roundTimes: { round: number; seconds: number }[] = []) {
  const active = makeWorkoutDetail({ sections: [{ name: "Main", timer, roundTimes }], exercises: [{ modality: "weight_reps", name: "A", sectionIndex: 0 }] });
  const fake = createWorkoutFake({ active });
  server.use(...fake.handlers);
  return { fake, id: active.sections[0]!.id };
}
const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const AMRAP12: SectionTimer = { format: "amrap", capSeconds: 720 };

describe("10.7 AC57 — the fake applies the 09.5 rules", () => {
  it("round 6 on a 5-round Set Timer is a 422 on round", async () => {
    const { id } = boot(SET5);
    const res = await call("PUT", `/workout-sections/${id}/round-times/6`, { seconds: 200 });
    expect(res.status).toBe(422);
    expect(errorPaths(res.json)).toEqual(["round"]);
  });

  it("an AMRAP reading must sit between its neighbors", async () => {
    const { fake, id } = boot(AMRAP12, [{ round: 1, seconds: 250 }, { round: 3, seconds: 770 }]);
    expect((await call("PUT", `/workout-sections/${id}/round-times/2`, { seconds: 800 })).status).toBe(422);
    const ok = await call("PUT", `/workout-sections/${id}/round-times/2`, { seconds: 515 });
    expect(ok.status).toBe(200);
    expect(ok.json!["roundTimes"]).toEqual([{ round: 1, seconds: 250 }, { round: 2, seconds: 515 }, { round: 3, seconds: 770 }]);
    expect(fake.state.active!.sections[0]!.roundTimes).toHaveLength(3);
  });

  it("a Set Timer result PUT is 409 section-timer-mismatch; an untimed section's round PUT too", async () => {
    const { id } = boot(SET5);
    const res = await call("PUT", `/workout-sections/${id}/result`, { rounds: 5, reps: 7 });
    expect(res.status).toBe(409);
    expect(slugOf(res.json)).toBe("section-timer-mismatch");
    const untimed = boot(null);
    const round = await call("PUT", `/workout-sections/${untimed.id}/round-times/1`, { seconds: 200 });
    expect(slugOf(round.json)).toBe("section-timer-mismatch");
  });

  it("an AMRAP result missing reps is a 422; a whole one is stored as the full object", async () => {
    const { fake, id } = boot(AMRAP12);
    expect((await call("PUT", `/workout-sections/${id}/result`, { rounds: 5 })).status).toBe(422);
    const ok = await call("PUT", `/workout-sections/${id}/result`, { rounds: 5, reps: 7 });
    expect(ok.status).toBe(200);
    expect(fake.state.active!.sections[0]!.result).toEqual({ rounds: 5, reps: 7, finishSeconds: null, capped: false });
  });

  it("the same PUT twice leaves the same stored section", async () => {
    const { fake, id } = boot(AMRAP12);
    await call("PUT", `/workout-sections/${id}/round-times/1`, { seconds: 250 });
    await call("PUT", `/workout-sections/${id}/result`, { rounds: 5, reps: 7 });
    const once = structuredClone(fake.state.active!.sections[0]);
    await call("PUT", `/workout-sections/${id}/round-times/1`, { seconds: 250 });
    await call("PUT", `/workout-sections/${id}/result`, { rounds: 5, reps: 7 });
    expect(fake.state.active!.sections[0]).toEqual(once);
  });

  it("DELETE of a missing round or result is 204; both clear what is stored", async () => {
    const { fake, id } = boot(AMRAP12, [{ round: 1, seconds: 250 }]);
    expect((await call("DELETE", `/workout-sections/${id}/round-times/4`)).status).toBe(204);
    expect((await call("DELETE", `/workout-sections/${id}/round-times/1`)).status).toBe(204);
    expect(fake.state.active!.sections[0]!.roundTimes).toEqual([]);
    expect((await call("DELETE", `/workout-sections/${id}/result`)).status).toBe(204);
  });

  it("a round param of 03 is a 422 on round; an unknown section is 404", async () => {
    const { id } = boot(SET5);
    const res = await call("PUT", `/workout-sections/${id}/round-times/03`, { seconds: 200 });
    expect(res.status).toBe(422);
    expect(errorPaths(res.json)).toEqual(["round"]);
    expect((await call("PUT", "/workout-sections/00000000-0000-4000-8000-0000000000ff/round-times/1", { seconds: 200 })).status).toBe(404);
    expect((await call("DELETE", "/workout-sections/00000000-0000-4000-8000-0000000000ff/result")).status).toBe(404);
  });

  it("every request is recorded, in order", async () => {
    const { fake, id } = boot(AMRAP12);
    await call("PUT", `/workout-sections/${id}/round-times/1`, { seconds: 250 });
    await call("DELETE", `/workout-sections/${id}/round-times/1`);
    expect(fake.requests.map((r) => `${r.method} ${r.path.replace(id, "S")}`)).toEqual(["PUT /v1/workout-sections/S/round-times/1", "DELETE /v1/workout-sections/S/round-times/1"]);
  });
});
