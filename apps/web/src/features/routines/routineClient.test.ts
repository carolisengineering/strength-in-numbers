// apps/web/src/features/routines/routineClient.test.ts
import { describe, expect, it, vi } from "vitest";
import { RoutineSchema } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import { makeRoutine } from "../../test/workoutFixtures";
import { createRoutineClient } from "./routineClient";

function fakeApi() {
  const routine = makeRoutine();
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const api = {
    get: vi.fn(async (path: string, schema?: { parse: (v: unknown) => unknown }) => {
      calls.push({ method: "GET", path });
      const data = path === "/v1/routines" ? { routines: [routine] } : routine;
      return schema ? schema.parse(data) : data;
    }),
    post: vi.fn(async (path: string, body: unknown, schema?: { parse: (v: unknown) => unknown }) => {
      calls.push({ method: "POST", path, body });
      return schema ? schema.parse(routine) : routine;
    }),
    request: vi.fn(async (path: string, options: { method?: string; body?: unknown; schema?: { parse: (v: unknown) => unknown } }) => {
      calls.push({ method: options.method ?? "GET", path, body: options.body });
      return options.schema ? options.schema.parse(routine) : routine;
    }),
    delete: vi.fn(async (path: string) => {
      calls.push({ method: "DELETE", path });
      return undefined;
    }),
  };
  return { api, calls, routine };
}

const body = { name: "Push A", items: [{ exerciseId: exerciseId(1) }] };

describe("10.0 AC10 — the routine client builds the right requests", () => {
  it("list / get / create / replace / remove", async () => {
    const { api, calls, routine } = fakeApi();
    const client = createRoutineClient(api as unknown as Parameters<typeof createRoutineClient>[0]);
    expect(await client.list()).toEqual([routine]);
    expect(await client.get("abc")).toEqual(routine);
    await client.create(body);
    await client.replace("abc", body);
    await client.remove("abc");
    expect(calls).toEqual([
      { method: "GET", path: "/v1/routines" },
      { method: "GET", path: "/v1/routines/abc" },
      { method: "POST", path: "/v1/routines", body },
      { method: "PUT", path: "/v1/routines/abc", body },
      { method: "DELETE", path: "/v1/routines/abc" },
    ]);
    expect(api.get.mock.calls[1]![1]).toBe(RoutineSchema);
  });

  it("encodes every id as one path segment", async () => {
    const { api, calls } = fakeApi();
    const client = createRoutineClient(api as unknown as Parameters<typeof createRoutineClient>[0]);
    await client.get("a/b?c#d");
    await client.replace("a/b?c#d", body);
    await client.remove("a/b?c#d");
    expect(calls.map((c) => c.path)).toEqual([
      "/v1/routines/a%2Fb%3Fc%23d",
      "/v1/routines/a%2Fb%3Fc%23d",
      "/v1/routines/a%2Fb%3Fc%23d",
    ]);
  });
});
