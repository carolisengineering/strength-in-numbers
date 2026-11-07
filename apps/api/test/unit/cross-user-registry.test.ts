import { describe, expect, it } from "vitest";
import type { RouteOptions } from "fastify";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeUserRepository, makeUser } from "../helpers/fakes.js";
import { collectRoutes, NON_V1_ROUTES } from "../integration/cross-user/registry.js";

/** Spec 21.0 §6.1: the route registry the cross-user suite reads from the app itself. */

const build = (onRoute?: (route: RouteOptions) => void) =>
  buildTestApp(onRoute ? { onRoute } : {}).then((r) => r.app);

describe("AC1 — the registry lists exactly the app's /v1 routes", () => {
  it("holds 51 /v1 route keys as Fastify templates, with no HEAD or OPTIONS entries", async () => {
    const { v1 } = await collectRoutes(build);
    const keys = v1.map((r) => r.key);
    expect(keys).toHaveLength(51);
    expect(new Set(keys).size).toBe(51);
    expect(keys).toContain("GET /v1/workouts/:id");
    expect(keys).toContain("PUT /v1/workout-sections/:id/round-times/:round");
    expect(keys.filter((k) => k.startsWith("HEAD ") || k.startsWith("OPTIONS "))).toEqual([]);
  });

  it("keeps each route's schema for the id-slot walker", async () => {
    const { v1 } = await collectRoutes(build);
    const route = v1.find((r) => r.key === "GET /v1/workouts/:id");
    expect(route?.schema?.params).toBeDefined();
  });
});

describe("AC2 — the onRoute seam is inert", () => {
  it("registers the same routes with and without the observer", async () => {
    const without = await build();
    await without.ready();
    const seen: string[] = [];
    const withObserver = await build((r) => seen.push(String(r.method)));
    await withObserver.ready();
    expect(seen.length).toBeGreaterThan(51);
    expect(withObserver.printRoutes({ commonPrefix: false })).toBe(without.printRoutes({ commonPrefix: false }));
    await without.close();
    await withObserver.close();
  });

  it("collects the same keys in the same order on every build", async () => {
    const first = await collectRoutes(build);
    const second = await collectRoutes(build);
    expect(second.v1.map((r) => r.key)).toEqual(first.v1.map((r) => r.key));
  });

  it("answers GET /v1/me byte-identically with and without the observer", async () => {
    const strip = (h: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(h).filter(([k]) => k !== "x-request-id" && k !== "date"));
    // The same stored user in both apps, so the body can be compared byte for byte.
    const user = makeUser({ id: "0192a1b2-0000-7000-8000-0000000000aa" });
    const plain = (await buildTestApp({ userRepository: new FakeUserRepository([user]) })).app;
    const observed = (await buildTestApp({ userRepository: new FakeUserRepository([user]), onRoute: () => {} })).app;
    const a = await plain.inject({ method: "GET", url: "/v1/me", headers: { authorization: "Bearer t" } });
    const b = await observed.inject({ method: "GET", url: "/v1/me", headers: { authorization: "Bearer t" } });
    expect(b.statusCode).toBe(a.statusCode);
    expect(b.body).toBe(a.body);
    expect(strip(b.headers)).toEqual(strip(a.headers));
    await plain.close();
    await observed.close();
  });
});

describe("AC4 — non-/v1 routes are on a reasoned allow-list", () => {
  it("every registered route outside /v1 is listed, and nothing listed is missing", async () => {
    const { other } = await collectRoutes(build);
    const keys = other.map((r) => r.key).sort();
    expect(keys).toEqual(Object.keys(NON_V1_ROUTES).sort());
  });

  it("every allow-list entry carries a reason", () => {
    for (const [key, reason] of Object.entries(NON_V1_ROUTES)) {
      expect(reason.trim(), key).not.toBe("");
    }
  });
});
