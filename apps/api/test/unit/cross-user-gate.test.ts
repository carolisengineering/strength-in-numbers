import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RegisteredRoute, RouteKey } from "../integration/cross-user/registry.js";
import { EXEMPTIONS } from "../integration/cross-user/exemptions.js";
import { NOT_A_SIN_ID, SPEC_MANDATED_NOT_A_SIN_ID, idSlots, requiredSlots, staleNotASinIdEntries } from "../integration/cross-user/slots.js";
import { checkCoverage } from "../integration/cross-user/gate.js";
import type { CrossUserCase } from "../integration/cross-user/cases.js";
import { collectRoutes } from "../integration/cross-user/registry.js";
import { buildTestApp } from "../helpers/build-test-app.js";

/** Spec 21.0 §6.1, §6.5: the coverage gate, the exemption list and the id-slot walker. */

function route(key: RouteKey, schema: RegisteredRoute["schema"] = {}): RegisteredRoute {
  const [method, url] = key.split(" ") as [string, string];
  return { key, method, url, schema };
}

/** A case with only the fields the gate reads: a `foreign-id` case when it covers a slot, else a `collection`. */
function caseFor(key: RouteKey, covers: string[] = [], name = "case", kind: CrossUserCase["kind"] = covers.length > 0 ? "foreign-id" : "collection"): CrossUserCase {
  return {
    route: key,
    name,
    covers,
    kind,
    expect: { status: 404 },
    actor: "A",
    call: () => ({ method: "GET", url: "/" }),
    control: () => ({ method: "GET", url: "/", expectStatus: 200 }),
  };
}

const noSlots = () => [];

describe("AC3 — the coverage gate", () => {
  it("names a registered route with neither a case nor an exemption", () => {
    const failures = checkCoverage(["GET /v1/things/:id", "GET /v1/other"], [caseFor("GET /v1/other")], {}, noSlots);
    expect(failures).toEqual(["GET /v1/things/:id has no cross-user case or exemption"]);
  });

  it("names a case or an exemption for a route the app does not register (stale entry)", () => {
    const failures = checkCoverage(
      ["GET /v1/other"],
      [caseFor("GET /v1/other"), caseFor("DELETE /v1/gone/:id")],
      { "GET /v1/retired": "a reason" },
      noSlots,
    );
    expect(failures).toContain("stale entry: case for DELETE /v1/gone/:id names a route the app does not register");
    expect(failures).toContain("stale entry: exemption for GET /v1/retired names a route the app does not register");
    expect(failures).toHaveLength(2);
  });

  it("names a route that is both covered and exempt", () => {
    const failures = checkCoverage(["GET /v1/me"], [caseFor("GET /v1/me")], { "GET /v1/me": "a reason" }, noSlots);
    expect(failures).toEqual(["GET /v1/me is both covered by a case and exempt"]);
  });

  it("names an id slot no case covers", () => {
    const slots = (k: RouteKey) => (k === "POST /v1/routines/:id" ? ["params.id", "body.items[].exerciseId"] : []);
    const failures = checkCoverage(["POST /v1/routines/:id"], [caseFor("POST /v1/routines/:id", ["params.id"])], {}, slots);
    expect(failures).toEqual(["POST /v1/routines/:id slot body.items[].exerciseId is not covered"]);
  });

  it("names a case that claims a slot the route does not have", () => {
    const slots = () => ["params.id"];
    const failures = checkCoverage(["GET /v1/x/:id"], [caseFor("GET /v1/x/:id", ["params.id"]), caseFor("GET /v1/x/:id", ["body.nope"], "B's x")], {}, slots);
    expect(failures).toEqual(['GET /v1/x/:id case "B\'s x" covers body.nope, which the route does not have']);
  });

  it("21.0 AC6 — minor 376: a foreign-id case covers exactly one slot (the runner puts B's id in one)", () => {
    const slots = () => ["params.id", "body.exerciseId"];
    const two = checkCoverage(["POST /v1/x/:id"], [caseFor("POST /v1/x/:id", ["params.id", "body.exerciseId"], "two at once")], {}, slots);
    // Neither slot counts as covered: the runner would aim B's id at the first only.
    expect(two).toEqual([
      'POST /v1/x/:id case "two at once" is a foreign-id case covering 2 slots; it must cover exactly one',
      "POST /v1/x/:id slot params.id is not covered",
      "POST /v1/x/:id slot body.exerciseId is not covered",
    ]);
    const none = checkCoverage(
      ["POST /v1/x/:id"],
      [caseFor("POST /v1/x/:id", ["params.id"]), caseFor("POST /v1/x/:id", ["body.exerciseId"]), caseFor("POST /v1/x/:id", [], "aims at nothing", "foreign-id")],
      {},
      slots,
    );
    expect(none).toEqual(['POST /v1/x/:id case "aims at nothing" is a foreign-id case covering 0 slots; it must cover exactly one']);
  });

  it("21.0 AC6 — minor 376: a collection, collision or write-isolation case covers no slot (it sends no foreign id)", () => {
    const slots = () => ["params.id"];
    for (const kind of ["collection", "collision", "write-isolation"] as const) {
      const failures = checkCoverage(["GET /v1/x/:id"], [caseFor("GET /v1/x/:id", ["params.id"], "claims it", kind)], {}, slots);
      expect(failures).toEqual([`GET /v1/x/:id case "claims it" is a ${kind} case but claims params.id; only a foreign-id case covers a slot`, "GET /v1/x/:id slot params.id is not covered"]);
    }
  });

  it("names an exempt route that takes an id (an exemption covers no id slot)", () => {
    const slots = (k: RouteKey) => (k === "PATCH /v1/me" ? ["body.favoriteRoutineId"] : []);
    const failures = checkCoverage(["PATCH /v1/me"], [], { "PATCH /v1/me": "own row only" }, slots);
    expect(failures).toEqual(["PATCH /v1/me is exempt but takes body.favoriteRoutineId; an id slot needs a case"]);
  });

  it("passes when every route and slot is accounted for", () => {
    const slots = (k: RouteKey) => (k === "GET /v1/x/:id" ? ["params.id"] : []);
    expect(checkCoverage(["GET /v1/x/:id", "GET /v1/me"], [caseFor("GET /v1/x/:id", ["params.id"])], { "GET /v1/me": "r" }, slots)).toEqual([]);
  });
});

describe("AC5 — exemptions carry reasons", () => {
  it("are exactly the five routes of spec §5", () => {
    expect(Object.keys(EXEMPTIONS).sort()).toEqual(
      ["GET /v1/_authcheck", "GET /v1/equipment", "GET /v1/me", "GET /v1/muscle-groups", "PATCH /v1/me"].sort(),
    );
  });

  it("each has a non-empty reason", () => {
    for (const [key, reason] of Object.entries(EXEMPTIONS)) expect(reason.trim(), key).not.toBe("");
  });
});

describe("AC6 — id slots are derived from the route's schemas", () => {
  it("every path parameter is a slot", () => {
    expect(idSlots(route("PUT /v1/workout-sections/:id/round-times/:round"))).toEqual(["params.id", "params.round"]);
  });

  it("walks objects and arrays in the body", () => {
    const body = z.object({ name: z.string(), items: z.array(z.object({ exerciseId: z.string(), reps: z.number() })) });
    expect(idSlots(route("POST /v1/routines", { body }))).toEqual(["body.items[].exerciseId"]);
  });

  it("walks optional, nullable, default and readonly wrappers", () => {
    const body = z.object({ routineId: z.string().nullable().optional(), sectionId: z.string().default("x").readonly() });
    expect(idSlots(route("POST /v1/x", { body }))).toEqual(["body.routineId", "body.sectionId"]);
  });

  it("finds an id inside a union, a discriminated union, an intersection, a pipe and a lazy schema", () => {
    const body = z.object({
      u: z.union([z.object({ aId: z.string() }), z.object({ bId: z.string() })]),
      d: z.discriminatedUnion("k", [z.object({ k: z.literal("x"), cId: z.string() })]),
      i: z.intersection(z.object({ dId: z.string() }), z.object({ eId: z.string() })),
      p: z.object({ fId: z.string() }).pipe(z.object({ fId: z.string() })),
      l: z.lazy(() => z.object({ gId: z.string() })),
      t: z.string().transform((s) => s.trim()),
    });
    expect(idSlots(route("POST /v1/x", { body }))).toEqual([
      "body.u.aId",
      "body.u.bId",
      "body.d.cId",
      "body.i.dId",
      "body.i.eId",
      "body.p.fId",
      "body.l.gId",
    ]);
  });

  it("reads the querystring as well as the body", () => {
    const querystring = z.object({ exerciseId: z.string().optional(), workoutId: z.string().optional(), limit: z.number() });
    expect(idSlots(route("GET /v1/personal-records", { querystring }))).toEqual(["query.exerciseId", "query.workoutId"]);
  });

  it("a plural key (`ids`, `workoutIds`) holding an array of ids is a slot", () => {
    const body = z.object({ ids: z.array(z.string()), workoutIds: z.array(z.string()).optional(), idsCount: z.number() });
    expect(idSlots(route("POST /v1/bulk", { body }))).toEqual(["body.ids", "body.workoutIds"]);
  });

  it("an `id` key counts, a key merely containing `id` does not", () => {
    const body = z.object({ id: z.string(), idempotent: z.boolean(), valid: z.boolean() });
    expect(idSlots(route("POST /v1/x", { body }))).toEqual(["body.id"]);
  });

  it("throws, naming the route and the wrapper, on a schema kind it does not know (fails closed)", () => {
    const body = z.object({ byId: z.record(z.string(), z.string()) });
    expect(() => idSlots(route("POST /v1/x", { body }))).toThrow(/POST \/v1\/x.*record/);
  });

  it("a slot on NOT_A_SIN_ID is not required", () => {
    const body = z.object({ clientGeneratedId: z.string(), routineId: z.string().optional() });
    expect(requiredSlots(route("POST /v1/workouts", { body }))).toEqual(["body.routineId"]);
    expect(requiredSlots(route("PUT /v1/workout-sections/:id/round-times/:round"))).toEqual(["params.id"]);
  });

  it("every NOT_A_SIN_ID entry carries a reason", () => {
    for (const [key, reason] of Object.entries(NOT_A_SIN_ID)) expect(reason.trim(), key).not.toBe("");
  });

  describe("minor 377 — NOT_A_SIN_ID entries that excuse no slot are reported", () => {
    const routes = [
      route("POST /v1/workouts", { body: z.object({ clientGeneratedId: z.string(), routineId: z.string().optional() }) }),
      route("PUT /v1/things/:id/rounds/:round"),
    ];
    const entries = (list: string[]) => Object.fromEntries(list.map((k) => [k, "a reason"]));

    it("a wildcard no route's slot ends with, and a route entry for an unregistered route or a slot it lacks, are stale", () => {
      const list = entries(["* clientGeneratedId", "* nope", "POST /v1/nothing nope", "PUT /v1/things/:id/rounds/:round params.round", "PUT /v1/things/:id/rounds/:round params.gone"]);
      expect(staleNotASinIdEntries(routes, list)).toEqual(["* nope", "POST /v1/nothing nope", "PUT /v1/things/:id/rounds/:round params.gone"]);
    });

    it("`* sourceExerciseId` is response-only and required by the spec, so it is never stale", () => {
      expect(SPEC_MANDATED_NOT_A_SIN_ID).toEqual(["* sourceExerciseId"]);
      expect(staleNotASinIdEntries(routes, entries(["* sourceExerciseId"]))).toEqual([]);
    });

    it("an allow-listed entry that does match a slot is reported: the allow-list would hide a real id", () => {
      const withSlot = [route("POST /v1/x", { body: z.object({ sourceExerciseId: z.string() }) })];
      expect(staleNotASinIdEntries(withSlot, entries(["* sourceExerciseId"]))).toEqual(["* sourceExerciseId (allow-listed as response-only, but a route now takes it)"]);
    });
  });
});

describe("AC6 — the walker reads every real /v1 route", () => {
  it("derives slots for all 51 routes without meeting an unknown schema kind", async () => {
    const { v1 } = await collectRoutes((onRoute) => buildTestApp({ onRoute }).then((r) => r.app));
    const all = Object.fromEntries(v1.map((r) => [r.key, idSlots(r)]));
    expect(all["POST /v1/routines"]).toContain("body.items[].exerciseId");
    expect(all["PUT /v1/hevy/mapping"]).toContain("body.pairs[].exerciseId");
    expect(all["GET /v1/personal-records"]).toEqual(["query.exerciseId", "query.workoutId"]);
    expect(all["POST /v1/workouts"]).toEqual(["body.clientGeneratedId", "body.routineId"]);
    const required = Object.fromEntries(v1.map((r) => [r.key, requiredSlots(r)]));
    // Spec §5 rows 9 and 50: shared reference ids and Hevy's own ids are not slots.
    expect(all["POST /v1/exercises"]).toContain("body.secondaryMuscleIds");
    expect(required["POST /v1/exercises"]).toEqual([]);
    expect(required["PATCH /v1/exercises/:id"]).toEqual(["params.id"]);
    expect(required["POST /v1/hevy/import/workouts"]).toEqual([]);
    expect(required["PUT /v1/hevy/mapping"]).toEqual(["body.pairs[].exerciseId"]);
    // Minor 377: every real entry still excuses a real slot.
    expect(staleNotASinIdEntries(v1)).toEqual([]);
  });

  it("21.0 AC6 — minor 376: the real case table passes the gate's kind rules", async () => {
    const { v1 } = await collectRoutes((onRoute) => buildTestApp({ onRoute }).then((r) => r.app));
    const { CASES } = await import("../integration/cross-user/cases.js");
    const byKey = new Map(v1.map((r) => [r.key, r]));
    expect(checkCoverage([...byKey.keys()], CASES, EXEMPTIONS, (key) => requiredSlots(byKey.get(key)!))).toEqual([]);
  });
});

describe("the case table stays valid as the calendar moves", () => {
  afterEach(() => vi.useRealTimers());

  it("every workout start a case sends is within the API's 7-day past limit, on any run date", async () => {
    vi.useFakeTimers({ now: new Date("2027-03-15T12:00:00Z") });
    const { CASES } = await import("../integration/cross-user/cases.js");
    const ids = new Proxy({}, { get: () => "0192a1b2-0000-7000-8000-00000000c001" });
    const world = { a: ids, b: ids, c: ids, globalExercise: "g", globalOnlyB: "g2" } as never;
    const starts: string[] = [];
    for (const c of CASES) {
      for (const req of [c.call(world, "0192a1b2-0000-7000-8000-00000000c002"), c.control(world, "x y")]) {
        const startedAt = (req.body as { startedAt?: unknown } | undefined)?.startedAt;
        if (req.url === "/v1/workouts" && typeof startedAt === "string") starts.push(startedAt);
      }
    }
    expect(starts.length).toBeGreaterThan(0);
    for (const s of starts) expect(Date.now() - Date.parse(s), s).toBeLessThan(7 * 24 * 3_600_000);
  });
});
