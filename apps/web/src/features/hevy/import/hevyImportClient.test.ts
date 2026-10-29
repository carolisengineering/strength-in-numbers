import { describe, expect, it } from "vitest";
import { fakeImportApi, makeImportWorkout as importWorkout, testApiClient as testApi } from "../../../test/hevyImportFakes";
import { server } from "../../../test/msw/server";
import { createHevyImportClient, ImportReplyError } from "./hevyImportClient";
import { runDryRun } from "./dryRun";

function setup(options: Parameters<typeof fakeImportApi>[0] = {}) {
  const fake = fakeImportApi(options);
  server.use(...fake.handlers);
  return { fake, client: createHevyImportClient(testApi()) };
}

describe("20.1 AC11 — the import client", () => {
  it("sends the batch and returns the parsed reply", async () => {
    const { fake, client } = setup();
    const reply = await client.importBatch({ dryRun: true, workouts: [importWorkout("a"), importWorkout("b")] });
    expect(reply.results.map((r) => r.outcome)).toEqual(["create", "create"]);
    expect(fake.log[0]).toMatchObject({ path: "/v1/hevy/import/workouts", method: "POST", contentType: "application/json" });
  });

  it("a reply with fewer results than sent is an ImportReplyError (mismatch)", async () => {
    const { fake, client } = setup();
    fake.failNext("short");
    const failure = await client.importBatch({ dryRun: true, workouts: [importWorkout("a"), importWorkout("b")] }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ImportReplyError);
    expect(failure).toMatchObject({ kind: "mismatch" });
  });

  it("a reply that fails the schema is an ImportReplyError (schema), even outside production", async () => {
    const { fake, client } = setup();
    fake.failNext("garbage");
    await expect(client.importBatch({ dryRun: true, workouts: [importWorkout("a")] })).rejects.toMatchObject({ kind: "schema" });
  });
});

describe("20.1 AC22 — finish request", () => {
  it("sends a POST with no body and no Content-Type, and parses the reply", async () => {
    const { fake, client } = setup({ recordsStale: true });
    expect(await client.finish()).toEqual({ recomputed: true, rootCount: 3 });
    expect(fake.log).toEqual([{ path: "/v1/hevy/import/finish", method: "POST", contentType: null, body: undefined }]);
  });
});

describe("20.1 AC11 — dry run", () => {
  const sixty = Array.from({ length: 60 }, (_, i) => importWorkout(`w${String(i).padStart(2, "0")}`));

  it("sends batches of 25 with dryRun: true, reports progress and changes nothing", async () => {
    const { fake, client } = setup();
    const progress: [number, number][] = [];
    const results = await runDryRun(client, sixty, { signal: new AbortController().signal, onProgress: (d, t) => progress.push([d, t]) });
    expect(results).toHaveLength(60);
    expect(fake.log).toHaveLength(3);
    expect(fake.log.every((r) => (r.body as { dryRun: boolean }).dryRun === true)).toBe(true);
    expect(fake.links.size).toBe(0);
    expect(fake.state.recordsStale).toBe(false);
    expect(progress).toEqual([
      [25, 60],
      [50, 60],
      [60, 60],
    ]);
  });

  it("a 429 waits Retry-After and sends the same batch again", async () => {
    const { fake, client } = setup();
    fake.failNext(429);
    const waits: number[] = [];
    await runDryRun(client, sixty.slice(0, 3), {
      signal: new AbortController().signal,
      sleep: async (ms) => {
        waits.push(ms);
      },
      onProgress: () => {},
    });
    expect(waits).toEqual([2000]);
    expect(fake.log).toHaveLength(2);
    expect(fake.log[1]!.body).toEqual(fake.log[0]!.body);
  });

  it("a mismatched reply rejects with ImportReplyError", async () => {
    const { fake, client } = setup();
    fake.failNext("short");
    await expect(runDryRun(client, sixty.slice(0, 25), { signal: new AbortController().signal, onProgress: () => {} })).rejects.toBeInstanceOf(ImportReplyError);
  });

  it("another failure rejects", async () => {
    const { fake, client } = setup();
    fake.failNext(500);
    await expect(runDryRun(client, sixty.slice(0, 2), { signal: new AbortController().signal, onProgress: () => {} })).rejects.toMatchObject({ status: 500 });
  });

  it("claims a SIN workout per batch only (§6.6)", async () => {
    const duplicateOf = new Map(sixty.map((w) => [w.hevyWorkoutId, "00000000-0000-4000-8000-00000000abcd"]));
    const { client } = setup({ duplicateOf });
    const results = await runDryRun(client, sixty, { signal: new AbortController().signal, onProgress: () => {} });
    expect(results.filter((r) => r.outcome === "duplicate")).toHaveLength(3);
  });

  it("an empty list sends nothing", async () => {
    const { fake, client } = setup();
    expect(await runDryRun(client, [], { signal: new AbortController().signal, onProgress: () => {} })).toEqual([]);
    expect(fake.log).toHaveLength(0);
  });
});
