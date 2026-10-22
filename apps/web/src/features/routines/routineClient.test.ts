import { describe, expect, it, vi } from "vitest";
import { RoutineSchema } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import { makeRoutine } from "../../test/workoutFixtures";
import { createApiClient } from "../../api/client";
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

describe("10.5 AC7 / AC17 — keep and the create option", () => {
  it("keep is one body-less POST to the encoded id", async () => {
    const { api } = fakeApi();
    const client = createRoutineClient(api as unknown as Parameters<typeof createRoutineClient>[0]);
    await client.keep("a/b");
    expect(api.request).toHaveBeenCalledTimes(1);
    const [path, options] = api.request.mock.calls[0]!;
    expect(path).toBe("/v1/routines/a%2Fb/keep");
    expect(options).toEqual({ method: "POST" });
    expect("body" in options).toBe(false);
  });

  it("create posts the body as given, or with oneOff: true when asked", async () => {
    const { api, calls } = fakeApi();
    const client = createRoutineClient(api as unknown as Parameters<typeof createRoutineClient>[0]);
    await client.create(body);
    await client.create(body, { oneOff: true });
    expect(calls).toEqual([
      { method: "POST", path: "/v1/routines", body },
      { method: "POST", path: "/v1/routines", body: { ...body, oneOff: true } },
    ]);
    expect("oneOff" in (calls[0]!.body as object)).toBe(false);
  });

  it("through the real API client, keep sends no Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const api = createApiClient({ baseUrl: "https://api.example.test", appEnv: "staging", getToken: async () => "tok", onAuthLost: vi.fn() });
      await createRoutineClient(api).keep("abc");
      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe("https://api.example.test/v1/routines/abc/keep");
      expect(init.method).toBe("POST");
      expect((init.headers as Headers).get("content-type")).toBeNull();
      expect(init.body).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
