// apps/api/test/integration/user-scoped.integration.test.ts
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../src/db/scoped.js";
import { createUserRepository, toUserRecord } from "../../src/repositories/user.prisma.js";
import type { UserRepository } from "../../src/repositories/user.js";
import { insertUser, shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 21.1 AC15 — provisioning is keyed on the token's `auth_sub`: the lookup, the insert and the re-read run with
 * `app.auth_sub` set; every write after authentication runs with `app.user_id`. The five former Prisma model calls are
 * raw statements now, and each result deep-equals a model read of the same row (the mapping is unchanged).
 */
describe.skipIf(!shouldRunIntegration())("Spec 21.1 AC15 — users and provisioning on the scoped handle", () => {
  let db: IntegrationDb;
  let repo: UserRepository;
  const events: { query: string; params: string }[] = [];

  /** The settings `run` sent, in order, as `[setting, value]`. */
  async function settingsOf(run: () => Promise<unknown>): Promise<[string, string][]> {
    events.length = 0;
    await run();
    return events
      .filter((e) => e.query.includes("set_config("))
      .map((e) => [/set_config\('([a-z_.]+)'/.exec(e.query)![1]!, (JSON.parse(e.params) as string[])[0]!]);
  }

  const modelRecord = async (id: string) => toUserRecord((await db.prisma.user.findUniqueOrThrow({ where: { id } })));

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    db.prisma.$on("query" as never, (e: { query: string; params: string }) => void events.push({ query: e.query, params: e.params }));
    repo = createUserRepository(createScopedDb(db.prisma));
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("findByAuthSub runs with app.auth_sub and returns what a model read returns", async () => {
    const id = await insertUser(db);
    let found: Awaited<ReturnType<UserRepository["findByAuthSub"]>> = null;
    expect(await settingsOf(async () => (found = await repo.findByAuthSub(`auth0|${id}`)))).toEqual([["app.auth_sub", `auth0|${id}`]]);
    expect(found).toEqual(await modelRecord(id));
    expect(await repo.findByAuthSub("auth0|nobody")).toBeNull();
  });

  it("provision (a new user): the insert and the re-read run with app.auth_sub; the result is the stored row", async () => {
    const sub = `auth0|${uuidv7()}`;
    let result: Awaited<ReturnType<UserRepository["provision"]>> | undefined;
    const settings = await settingsOf(async () => (result = await repo.provision({ authSub: sub, email: "new@ex.com", emailVerified: true })));
    expect(settings).toEqual([
      ["app.auth_sub", sub],
      ["app.auth_sub", sub],
    ]);
    expect(result!.isNewUser).toBe(true);
    expect(result!.user).toEqual(await modelRecord(result!.user.id));
    expect(result!.user).toMatchObject({ authSub: sub, email: "new@ex.com", emailVerified: true, unitPreference: "kg", timezone: "UTC", deletedAt: null });
  });

  it("provision (an existing user): not new, and the existing row comes back untouched", async () => {
    const id = await insertUser(db);
    const before = await modelRecord(id);
    const result = await repo.provision({ authSub: `auth0|${id}`, email: "other@ex.com", emailVerified: true });
    expect(result).toEqual({ user: before, isNewUser: false });
  });

  it("syncEmail runs with app.user_id; the result is the stored row with the new email and a fresh updatedAt", async () => {
    const id = await insertUser(db);
    const before = await modelRecord(id);
    let result: Awaited<ReturnType<UserRepository["syncEmail"]>> | undefined;
    expect(await settingsOf(async () => (result = await repo.syncEmail(id, "changed@ex.com", true)))).toEqual([["app.user_id", id]]);
    expect(result).toEqual(await modelRecord(id));
    expect(result).toMatchObject({ email: "changed@ex.com", emailVerified: true });
    expect(result!.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    expect(result!.createdAt).toEqual(before.createdAt);
  });

  it("updateProfile runs with app.user_id and changes only the fields in the patch", async () => {
    const id = await insertUser(db);
    let result: Awaited<ReturnType<UserRepository["updateProfile"]>> | undefined;
    expect(await settingsOf(async () => (result = await repo.updateProfile(id, { displayName: "Carol", unitPreference: "lb" })))).toEqual([
      ["app.user_id", id],
    ]);
    expect(result).toEqual(await modelRecord(id));
    expect(result).toMatchObject({ displayName: "Carol", unitPreference: "lb", timezone: "UTC" });

    const cleared = await repo.updateProfile(id, { displayName: null, timezone: "Europe/London" });
    expect(cleared).toEqual(await modelRecord(id));
    expect(cleared).toMatchObject({ displayName: null, unitPreference: "lb", timezone: "Europe/London" });

    const touchedOnly = await repo.updateProfile(id, {});
    expect(touchedOnly).toMatchObject({ displayName: null, unitPreference: "lb", timezone: "Europe/London" });
    expect(touchedOnly.updatedAt.getTime()).toBeGreaterThanOrEqual(cleared.updatedAt.getTime());
  });

  it("syncEmail / updateProfile on a missing row throw, as the model update did", async () => {
    await expect(repo.syncEmail(uuidv7(), "x@ex.com", false)).rejects.toThrow();
    await expect(repo.updateProfile(uuidv7(), { timezone: "UTC" })).rejects.toThrow();
  });

  it("markDeleted runs with app.user_id; a second call changes nothing", async () => {
    const id = await insertUser(db);
    let first: Date | null = null;
    expect(await settingsOf(async () => (first = await repo.markDeleted(id)))).toEqual([["app.user_id", id]]);
    expect(first).toEqual((await modelRecord(id)).deletedAt);
    expect(await repo.markDeleted(id)).toBeNull();
  });

  it("a bare PrismaClient (tests, maintenance) sends no setting at all", async () => {
    const bare = createUserRepository(db.prisma);
    const id = await insertUser(db);
    expect(await settingsOf(() => bare.findByAuthSub(`auth0|${id}`))).toEqual([]);
    expect(await settingsOf(() => bare.syncEmail(id, "bare@ex.com", false))).toEqual([]);
  });
});
