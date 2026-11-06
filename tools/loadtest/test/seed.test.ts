import { describe, expect, it } from "vitest";
import { RoutineCreateSchema } from "@sin/core";
import { ensureSeeded } from "../src/node/seed.ts";
import { seededRoutineSets } from "../src/plan/routine.ts";
import { accountEmail, accountIds } from "../src/node/accounts.ts";
import { FakeApi } from "./fake-api.ts";

describe("AC23 — seeding is idempotent", () => {
  it("creates the routine once and returns the same id on a second run", async () => {
    const api = new FakeApi();
    const first = await ensureSeeded(api);
    const second = await ensureSeeded(api);
    expect(api.calls.filter((c) => c === "POST /v1/routines")).toHaveLength(1);
    expect(second).toEqual(first);
    expect(first.sets).toEqual(seededRoutineSets());
  });

  it("the posted body uses the catalog's ids and passes the create schema", async () => {
    const api = new FakeApi();
    let posted: unknown;
    const post = api.post.bind(api);
    api.post = async (path, body) => {
      posted = body;
      return post(path, body);
    };
    await ensureSeeded(api);
    expect(RoutineCreateSchema.safeParse(posted).success).toBe(true);
    const ids = new Set(api.catalog.map((e) => e.id));
    for (const item of (posted as { items: { exerciseId: string }[] }).items) expect(ids.has(item.exerciseId)).toBe(true);
  });

  it("fails clearly when the catalog is missing a key", async () => {
    const api = new FakeApi();
    api.catalog = api.catalog.filter((e) => e.catalogKey !== "pull-up");
    await expect(ensureSeeded(api)).rejects.toThrow(/pull-up/);
  });
});

describe("accounts", () => {
  it("are loadtest|001… with an example.test address (spec §7)", () => {
    expect(accountIds(3)).toEqual(["loadtest|001", "loadtest|002", "loadtest|003"]);
    expect(accountEmail("loadtest|042")).toBe("loadtest+042@example.test");
  });
});
