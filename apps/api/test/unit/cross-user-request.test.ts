import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { nextDisposableDay } from "../integration/cross-user/cases.js";
import { LeakScanner } from "../integration/cross-user/compare.js";
import { crossUserRequester, mustAnswer } from "../integration/cross-user/request.js";

/** Minor 380: the one request helper the cross-user suite's world building and its runner share. */

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  payload?: string;
}

function fakeApp(answer: { statusCode: number; body: string }) {
  const sent: Sent[] = [];
  const app = {
    inject: (opts: Sent) => {
      sent.push(opts);
      return Promise.resolve({ ...answer, headers: { "content-type": "application/json" } });
    },
  } as unknown as FastifyInstance;
  return { app, sent };
}

const as = (actor: "A" | "B" | "C") => ({ authorization: `Bearer ${actor}` });

describe("minor 380 — one request helper for the world and the runner", () => {
  it("sends the actor's token, and a JSON body only when there is one", async () => {
    const { app, sent } = fakeApp({ statusCode: 200, body: "{}" });
    const request = crossUserRequester(app, as);
    await request("A", { method: "GET", url: "/v1/me" });
    await request("C", { method: "POST", url: "/v1/routines", body: { name: "x" } });
    expect(sent).toEqual([
      { method: "GET", url: "/v1/me", headers: { authorization: "Bearer A" } },
      { method: "POST", url: "/v1/routines", headers: { authorization: "Bearer C", "content-type": "application/json" }, payload: '{"name":"x"}' },
    ]);
  });

  it("a 429 fails by name, whoever sent the request, instead of reading as a wrong status", async () => {
    const { app } = fakeApp({ statusCode: 429, body: "{}" });
    const request = crossUserRequester(app, as);
    await expect(request("B", { method: "POST", url: "/v1/exercises", body: {} })).rejects.toThrow(
      "rate limited during the cross-user suite: raise GENEROUS_LIMITS (B POST /v1/exercises)",
    );
    await expect(mustAnswer(request, "A", { method: "GET", url: "/v1/me" }, 200, "world")).rejects.toThrow("rate limited during the cross-user suite");
  });

  it("every response A or C receives goes to the leak scan; B's own responses don't", async () => {
    const { app } = fakeApp({ statusCode: 200, body: '{"name":"B-SECRET-routine-1"}' });
    const scanner = new LeakScanner();
    const request = crossUserRequester(app, as, scanner);
    await request("B", { method: "GET", url: "/v1/routines" });
    expect(scanner.size).toBe(0);
    await request("A", { method: "GET", url: "/v1/routines" }, "world building");
    await request("C", { method: "GET", url: "/v1/routines" });
    expect(scanner.size).toBe(2);
    expect(() => scanner.assertClean([], ["B-SECRET-routine-1"])).toThrow("A world building contains B-SECRET-routine-1");
  });

  it("mustAnswer returns the parsed body, and names the caller on a wrong status", async () => {
    const { app } = fakeApp({ statusCode: 201, body: '{"id":"abc"}' });
    const request = crossUserRequester(app, as);
    expect(await mustAnswer(request, "A", { method: "POST", url: "/v1/x" }, 201)).toEqual({ id: "abc" });
    await expect(mustAnswer(request, "A", { method: "POST", url: "/v1/x" }, 200, "world")).rejects.toThrow('world: A POST /v1/x answered 201, expected 200: {"id":"abc"}');
    const empty = fakeApp({ statusCode: 204, body: "" });
    expect(await mustAnswer(crossUserRequester(empty.app, as), "A", { method: "DELETE", url: "/v1/x" }, 204)).toEqual({});
  });
});

describe("minor 386 — each disposable import gets a day of its own", () => {
  it("consecutive days are one day apart, an hour long, and far from every other day in the world", () => {
    const first = nextDisposableDay();
    const second = nextDisposableDay();
    expect(Date.parse(second.startTime) - Date.parse(first.startTime)).toBe(86_400_000);
    expect(Date.parse(first.endTime) - Date.parse(first.startTime)).toBe(3_600_000);
    // The world's own workouts are within the last week, and its Hevy imports on 2026-09-10.
    expect(first.startTime.startsWith("2025-")).toBe(true);
  });
});
