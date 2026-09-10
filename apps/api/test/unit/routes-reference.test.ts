import { describe, it, expect } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, fakeVerifier } from "../helpers/fakes.js";
import { InvalidTokenError } from "../../src/errors/app-error.js";
import type { ReferenceRecord } from "../../src/repositories/exercise.js";

const BEARER = { authorization: "Bearer test-token" };
const DTO_KEYS = ["id", "name", "displayOrder"].sort();

const MUSCLE_GROUPS: ReferenceRecord[] = [
  { id: "chest", name: "Chest", displayOrder: 1 },
  { id: "lats", name: "Lats", displayOrder: 2 },
];
const EQUIPMENT: ReferenceRecord[] = [
  { id: "barbell", name: "Barbell", displayOrder: 1 },
  { id: "dumbbell", name: "Dumbbell", displayOrder: 2 },
];

/**
 * Route-level coverage for the two reference endpoints (Spec 03.1 AC8). Ordering
 * (`display_order`, then `id COLLATE "C"`) is a repository concern verified by
 * the integration suite; here the fake returns rows as-given and the route must
 * relay them untouched, as `camelCase` DTOs, with the `ETag` / `304` / cache
 * headers.
 */
async function appWith(
  seed: Partial<Pick<FakeExerciseRepository, "muscleGroups" | "equipment">>,
) {
  const exerciseRepo = new FakeExerciseRepository();
  Object.assign(exerciseRepo, seed);
  return buildTestApp({ exerciseRepository: exerciseRepo });
}

describe.each([
  {
    label: "GET /v1/muscle-groups",
    url: "/v1/muscle-groups",
    key: "muscleGroups" as const,
    seed: { muscleGroups: MUSCLE_GROUPS },
    rows: MUSCLE_GROUPS,
  },
  {
    label: "GET /v1/equipment",
    url: "/v1/equipment",
    key: "equipment" as const,
    seed: { equipment: EQUIPMENT },
    rows: EQUIPMENT,
  },
])("$label — reference table (AC8)", ({ url, key, seed, rows }) => {
  it("returns the full table as camelCase DTOs in repository order", async () => {
    const { app } = await appWith(seed);
    const res = await app.inject({ method: "GET", url, headers: BEARER });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[key]).toHaveLength(rows.length);
    expect(body[key].map((row: { id: string }) => row.id)).toEqual(
      rows.map((row) => row.id),
    );
    expect(Object.keys(body[key][0]).sort()).toEqual(DTO_KEYS);
    expect(body[key][0]).toEqual({
      id: rows[0]!.id,
      name: rows[0]!.name,
      displayOrder: rows[0]!.displayOrder,
    });
  });

  it("401 without a token", async () => {
    const { app } = await appWith(seed);
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
  });

  it("401 with an invalid token", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    Object.assign(exerciseRepo, seed);
    const { app } = await buildTestApp({
      exerciseRepository: exerciseRepo,
      tokenVerifier: fakeVerifier(() => {
        throw new InvalidTokenError("signature check failed");
      }),
    });
    const res = await app.inject({ method: "GET", url, headers: BEARER });
    expect(res.statusCode).toBe(401);
  });

  it("200 carries a strong ETag + Cache-Control: private, no-cache + Vary: Authorization", async () => {
    const { app } = await appWith(seed);
    const res = await app.inject({ method: "GET", url, headers: BEARER });

    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(res.headers["cache-control"]).toBe("private, no-cache");
    expectVaryTokens(res.headers.vary);
  });

  it("If-None-Match match → 304, empty body, ETag + cache headers", async () => {
    const { app } = await appWith(seed);
    const first = await app.inject({ method: "GET", url, headers: BEARER });
    const etag = first.headers.etag as string;

    const second = await app.inject({
      method: "GET",
      url,
      headers: { ...BEARER, "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    expect(second.headers.etag).toBe(etag);
    expect(second.headers["cache-control"]).toBe("private, no-cache");
    expectVaryTokens(second.headers.vary);
  });

  it("a table change produces a different ETag and a 200 (not 304)", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    Object.assign(exerciseRepo, seed);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const before = await app.inject({ method: "GET", url, headers: BEARER });
    (exerciseRepo[key] as ReferenceRecord[]) = [
      ...rows,
      { id: "zzz", name: "New Thing", displayOrder: 9 },
    ];
    const after = await app.inject({
      method: "GET",
      url,
      headers: { ...BEARER, "if-none-match": before.headers.etag as string },
    });
    expect(after.statusCode).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
  });
});


/** `Vary` must carry the CORS plugin's `Origin` *and* our `Authorization`. */
function expectVaryTokens(vary: unknown): void {
  const tokens = String(vary).split(",").map((t) => t.trim().toLowerCase());
  expect(tokens).toContain("origin");
  expect(tokens).toContain("authorization");
}

describe("reference endpoints — cross-endpoint ETag isolation (AC8)", () => {
  it("an identical row list on the two endpoints yields different ETags", async () => {
    const shared: ReferenceRecord[] = [
      { id: "x", name: "X", displayOrder: 1 },
    ];
    const { app } = await appWith({ muscleGroups: shared, equipment: shared });

    const mg = await app.inject({
      method: "GET",
      url: "/v1/muscle-groups",
      headers: BEARER,
    });
    const eq = await app.inject({
      method: "GET",
      url: "/v1/equipment",
      headers: BEARER,
    });
    expect(mg.headers.etag).not.toBe(eq.headers.etag);
  });
});
