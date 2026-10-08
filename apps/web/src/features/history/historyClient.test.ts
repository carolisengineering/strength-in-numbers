import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WorkoutHistoryResponseSchema } from "@sin/core";
import { makeWorkoutSummary } from "../../test/workoutFixtures";
import { createHistoryClient } from "./historyClient";

function recordingApi(body: unknown) {
  const calls: { path: string; schema: unknown }[] = [];
  const api = {
    get: async (path: string, schema?: { parse: (x: unknown) => unknown }) => {
      calls.push({ path, schema });
      return schema ? schema.parse(body) : body;
    },
  };
  return { api: api as Parameters<typeof createHistoryClient>[0], calls };
}

describe("08.0 AC3 — the history client builds the right request", () => {
  it("page 1 asks for 20 rows and sends no cursor", async () => {
    const { api, calls } = recordingApi({ items: [makeWorkoutSummary()], next: null });
    const page = await createHistoryClient(api).listWorkouts({});

    expect(calls).toEqual([{ path: "/v1/workouts?limit=20", schema: WorkoutHistoryResponseSchema }]);
    expect(page.items).toHaveLength(1);
    expect(page.next).toBeNull();
  });

  it("passes a cursor through verbatim, percent-encoded", async () => {
    const cursor = "v1.ab+c/d=e&f#g?h";
    const { api, calls } = recordingApi({ items: [], next: null });
    await createHistoryClient(api).listWorkouts({ cursor });

    const url = new URL(`https://api.example.test${calls[0]!.path}`);
    expect(url.pathname).toBe("/v1/workouts");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("cursor")).toBe(cursor);
    expect([...url.searchParams.keys()]).toEqual(["limit", "cursor"]);
  });

  it("never decodes or builds a cursor (source scan of features/history)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(here)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => readFileSync(join(here, f), "utf8"));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toMatch(/\batob\b|\bbtoa\b|base64|["'`]v1\./);
    }
  });
});
