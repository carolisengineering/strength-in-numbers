import { describe, expect, it } from "vitest";
import { ProgressSeriesSchema } from "@sin/core";
import { makeProgressPoint } from "../../test/workoutFixtures";
import { createProgressClient } from "./progressClient";

const ID = "10000000-0000-4000-8000-0000000000e1";

function recordingApi(body: unknown) {
  const calls: { path: string; schema: unknown }[] = [];
  const api = {
    get: async (path: string, schema?: { parse: (x: unknown) => unknown }) => {
      calls.push({ path, schema });
      return schema ? schema.parse(body) : body;
    },
  };
  return { api: api as Parameters<typeof createProgressClient>[0], calls };
}

describe("08.1 AC5 — the progress client builds the right request", () => {
  const body = { exerciseId: ID, points: [makeProgressPoint()] };

  it("no from → bare path; parsed with ProgressSeriesSchema", async () => {
    const { api, calls } = recordingApi(body);
    const series = await createProgressClient(api).getSeries(ID, {});
    expect(calls).toEqual([{ path: `/v1/progress/exercises/${ID}`, schema: ProgressSeriesSchema }]);
    expect(series.points).toHaveLength(1);
  });

  it("from → ?from=YYYY-MM-DD, never to", async () => {
    const { api, calls } = recordingApi(body);
    await createProgressClient(api).getSeries(ID, { from: "2026-07-08" });
    const url = new URL(`https://api.example.test${calls[0]!.path}`);
    expect([...url.searchParams.entries()]).toEqual([["from", "2026-07-08"]]);
  });

  it("encodes the id so it cannot change the path or add a parameter", async () => {
    const { api, calls } = recordingApi(body);
    await createProgressClient(api).getSeries("a/b?c#d", {});
    const url = new URL(`https://api.example.test${calls[0]!.path}`);
    expect(url.pathname).toBe("/v1/progress/exercises/a%2Fb%3Fc%23d");
    expect(url.search).toBe("");
  });
});
