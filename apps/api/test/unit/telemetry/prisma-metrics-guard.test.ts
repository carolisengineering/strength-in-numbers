import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Spec 13.3 AC13 — the DB pool metrics read Prisma's `metrics` preview (`$metrics.json()`), which Prisma has
 * deprecated and removes in 7.0. These guards fail loudly on an upgrade that drops it, and pin the internal
 * `libraryStarted` flag the AC7 gate reads. The client is never queried, so nothing connects.
 */
const client = new PrismaClient({ datasourceUrl: "postgresql://u:p@127.0.0.1:1/x" });

afterAll(async () => {
  await client.$disconnect();
});

describe("AC13 — Prisma metrics preview is present", () => {
  it("the generated client exposes $metrics.json", () => {
    const metrics = (client as unknown as { $metrics?: { json?: unknown } }).$metrics;
    expect(
      typeof metrics?.json,
      "Prisma no longer exposes $metrics — see BL-25 and Spec 13.3 D2: move the pool source to pg.Pool",
    ).toBe("function");
  });

  // Without the generator's `previewFeatures = ["metrics"]`, 6.19.3 still defines `$metrics.json` but it throws
  // "`metrics` preview feature must be enabled" on every call. `_hasPreviewFlag` is the check that throw uses.
  it("the client was generated with the metrics preview flag", () => {
    const hasFlag = (client as unknown as { _hasPreviewFlag?: (f: string) => boolean })._hasPreviewFlag;
    expect(typeof hasFlag, "Prisma's client no longer has _hasPreviewFlag — re-check how Spec 13.3 AC13 is guarded").toBe(
      "function",
    );
    expect(
      hasFlag?.call(client, "metrics"),
      'schema.prisma\'s generator must declare previewFeatures = ["metrics"] (Spec 13.3 AC13); without it $metrics.json() throws',
    ).toBe(true);
  });

  it("the engine reports libraryStarted (the AC7 gate's signal)", () => {
    const engine = (client as unknown as { _engine?: Record<string, unknown> })._engine;
    const message =
      "Prisma's engine no longer has `libraryStarted` — Spec 13.3 AC7's gate (poolMetricsSource in db.ts) reads it; find the new 'engine started' signal";
    expect(engine !== undefined && "libraryStarted" in engine, message).toBe(true);
    expect(engine?.["libraryStarted"], message).toBe(false);
  });
});
