import { describe, it, expect } from "vitest";
import pino from "pino";
import { buildTestApp } from "../helpers/build-test-app.js";
import {
  FakeExerciseRepository,
  fakeVerifier,
  makeExerciseRecord,
} from "../helpers/fakes.js";
import {
  InvalidTokenError,
  SyncTokenExpiredError,
} from "../../src/errors/app-error.js";

const BEARER = { authorization: "Bearer test-token" };

const DTO_KEYS = [
  "id",
  "catalogKey",
  "ownerUserId",
  "name",
  "modality",
  "primaryMuscleId",
  "secondaryMuscleIds",
  "equipmentId",
  "isActive",
  "forkedFromExerciseId",
  "createdAt",
  "updatedAt",
].sort();


/** `Vary` must carry the CORS plugin's `Origin` *and* our `Authorization`. */
function expectVaryTokens(vary: unknown): void {
  const tokens = String(vary).split(",").map((t) => t.trim().toLowerCase());
  expect(tokens).toContain("origin");
  expect(tokens).toContain("authorization");
}

describe("GET /v1/exercises — full pull (03.1 AC5)", () => {
  it("returns the caller-visible catalog as camelCase Exercise DTOs", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [
      makeExerciseRecord({ name: "Back Squat", catalogKey: "back-squat" }),
    ];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.syncToken).toBe("string");
    expect(body.exercises).toHaveLength(1);
    expect(Object.keys(body.exercises[0]).sort()).toEqual(DTO_KEYS);
    expect(body.exercises[0]).toMatchObject({
      name: "Back Squat",
      catalogKey: "back-squat",
      modality: "weight_reps",
      ownerUserId: null,
      secondaryMuscleIds: [],
      isActive: true,
      createdAt: "2026-09-01T10:00:00.000Z",
    });
  });

  it("threads the acting user's id into the visibility filter", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const { app, repo } = await buildTestApp({
      exerciseRepository: exerciseRepo,
    });

    await app.inject({ method: "GET", url: "/v1/exercises", headers: BEARER });

    const user = await repo.findByAuthSub("auth0|user-123");
    expect(exerciseRepo.lastActingUserId).toBe(user!.id);
  });

  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/exercises" });
    expect(res.statusCode).toBe(401);
  });

  it("401 with an invalid token", async () => {
    const { app } = await buildTestApp({
      tokenVerifier: fakeVerifier(() => {
        throw new InvalidTokenError("signature check failed");
      }),
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("AC9 (03.1 AC7) — GET /v1/exercises ETag / 304 / caching under since/syncToken", () => {
  it("emits a strong ETag that is stable while only syncToken advances", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecord()];
    exerciseRepo.syncToken = "1.100";
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const a = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    const etag = a.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);

    exerciseRepo.syncToken = "1.200";
    const b = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    expect(b.headers.etag).toBe(etag);
    expect(b.json().syncToken).toBe("1.200");
  });

  it("If-None-Match match → 304, empty body, ETag + cache headers", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecord()];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const first = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    const etag = first.headers.etag as string;

    const second = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: { ...BEARER, "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    expect(second.headers.etag).toBe(etag);
    expect(second.headers["cache-control"]).toBe("private, no-cache");
    expectVaryTokens(second.headers.vary);
  });

  it("200 carries Cache-Control: private, no-cache + Vary: Authorization", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-cache");
    expectVaryTokens(res.headers.vary);
  });

  it("Vary keeps the CORS plugin's Origin token alongside Authorization", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: { ...BEARER, origin: "http://localhost:5173" },
    });
    expect(res.statusCode).toBe(200);
    const tokens = String(res.headers.vary)
      .split(",")
      .map((t) => t.trim().toLowerCase());
    expect(tokens).toContain("origin");
    expect(tokens).toContain("authorization");
  });

  it("a catalog change produces a different ETag and a 200 (not 304)", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecord({ name: "Squat" })];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const before = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });

    exerciseRepo.catalog = [
      ...exerciseRepo.catalog,
      makeExerciseRecord({ name: "Bench" }),
    ];
    const after = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: { ...BEARER, "if-none-match": before.headers.etag as string },
    });
    expect(after.statusCode).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
  });

  it("a delta that serializes to the same bytes as an earlier full pull gets a different ETag", async () => {
    const rec = makeExerciseRecord({ name: "Row" });
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [rec];
    exerciseRepo.delta = [rec];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const full = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    const delta = await app.inject({
      method: "GET",
      url: "/v1/exercises?since=1.100",
      headers: BEARER,
    });
    expect(full.headers.etag).not.toBe(delta.headers.etag);

    // a full-pull ETag replayed against the delta must NOT 304
    const replay = await app.inject({
      method: "GET",
      url: "/v1/exercises?since=1.100",
      headers: { ...BEARER, "if-none-match": full.headers.etag as string },
    });
    expect(replay.statusCode).toBe(200);
  });

  it("HEAD /v1/exercises returns the same ETag + cache headers, no body", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecord()];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const get = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    const head = await app.inject({
      method: "HEAD",
      url: "/v1/exercises",
      headers: BEARER,
    });
    expect(head.statusCode).toBe(200);
    expect(head.headers.etag).toBe(get.headers.etag);
    expect(head.headers["cache-control"]).toBe("private, no-cache");
    expectVaryTokens(head.headers.vary);
    expect(head.body).toBe("");
  });
});

describe("GET /v1/exercises — since delta (AC4/AC8)", () => {
  it("routes ?since=1.736 to the delta path with the bare xid", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.delta = [
      makeExerciseRecord({ name: "Changed", isActive: false }),
    ];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises?since=1.736",
      headers: BEARER,
    });

    expect(res.statusCode).toBe(200);
    expect(exerciseRepo.lastSince).toBe("736");
    expect(res.json().exercises[0]).toMatchObject({
      name: "Changed",
      isActive: false,
    });
    expect(res.json().syncToken).toBe("1.100");
  });

  it("a stray ?updated_since= is ignored like any unknown key → full pull", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecord({ name: "Full" })];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises?updated_since=2026-01-01T00:00:00Z",
      headers: BEARER,
    });

    expect(res.statusCode).toBe(200);
    expect(exerciseRepo.lastSince).toBeNull();
    expect(res.json().exercises[0].name).toBe("Full");
  });

  it.each([
    "2026-01-01T00:00:00Z",
    "1.-1",
    "abc",
    "1.01",
    "1.99999999999999999999",
    "2.736",
  ])("malformed since %s → 422 validation-error naming `since`, on GET and HEAD", async (bad) => {
    const { app } = await buildTestApp();
    const url = `/v1/exercises?since=${encodeURIComponent(bad)}`;

    const get = await app.inject({ method: "GET", url, headers: BEARER });
    expect(get.statusCode).toBe(422);
    expect(get.json().type).toContain("validation-error");
    expect(
      get.json().errors.some((e: { path: string }) => e.path === "since"),
    ).toBe(true);

    const head = await app.inject({ method: "HEAD", url, headers: BEARER });
    expect(head.statusCode).toBe(422);
    expect(String(head.headers["content-type"])).toContain(
      "application/problem+json",
    );
  });

  it("HEAD with a valid since mirrors GET's status and headers", async () => {
    const { app } = await buildTestApp();
    const url = "/v1/exercises?since=1.5";

    const get = await app.inject({ method: "GET", url, headers: BEARER });
    const head = await app.inject({ method: "HEAD", url, headers: BEARER });

    expect(head.statusCode).toBe(get.statusCode);
    expect(head.headers.etag).toBe(get.headers.etag);
    expect(head.body).toBe("");
  });

  it("AC11: updated_at stays in the ETag hash (rows differing only in updatedAt → different ETag)", async () => {
    const base = makeExerciseRecord({
      updatedAt: new Date("2026-09-01T10:00:00.000Z"),
    });
    const a = new FakeExerciseRepository();
    a.catalog = [base];
    const b = new FakeExerciseRepository();
    b.catalog = [{ ...base, updatedAt: new Date("2026-09-02T10:00:00.000Z") }];

    const ra = await (
      await buildTestApp({ exerciseRepository: a })
    ).app.inject({ method: "GET", url: "/v1/exercises", headers: BEARER });
    const rb = await (
      await buildTestApp({ exerciseRepository: b })
    ).app.inject({ method: "GET", url: "/v1/exercises", headers: BEARER });

    expect(ra.headers.etag).not.toBe(rb.headers.etag);
  });
});

describe("GET /v1/exercises — 410 sync-token-expired (AC8)", () => {
  const url = "/v1/exercises?since=1.999";

  it.each(["GET", "HEAD"] as const)(
    "%s → 410 problem+json with Cache-Control: no-store",
    async (method) => {
      const exerciseRepo = new FakeExerciseRepository();
      exerciseRepo.nextFindError = new SyncTokenExpiredError();
      const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

      const res = await app.inject({ method, url, headers: BEARER });

      expect(res.statusCode).toBe(410);
      expect(String(res.headers["content-type"])).toContain(
        "application/problem+json",
      );
      // A 410 is heuristically cacheable; a cached one would keep a healed client failing.
      expect(res.headers["cache-control"]).toBe("no-store");
      if (method === "GET") {
        expect(res.json().type).toContain("sync-token-expired");
      }
    },
  );

  it("is logged at warn with slug sync-token-expired, not at error", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = pino(
      { level: "debug" },
      {
        write: (s: string) => {
          lines.push(JSON.parse(s) as Record<string, unknown>);
        },
      },
    );
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.nextFindError = new SyncTokenExpiredError();
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo, logger });

    await app.inject({ method: "GET", url, headers: BEARER });

    const hit = lines.find((l) => l.slug === "sync-token-expired");
    expect(hit).toBeDefined();
    expect(hit!.level).toBe(40); // pino "warn"
    expect(lines.some((l) => l.level === 50 && l.msg === "request error")).toBe(false);
  });
});
