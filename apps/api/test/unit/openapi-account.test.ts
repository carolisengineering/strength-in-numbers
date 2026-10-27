import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

describe("AC1 / AC13 / AC32 — both account operations are published", () => {
  it("lists /v1/account/export (get, 200) and /v1/account (delete, 202) with inline body schemas", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
    expect(Object.keys(doc.paths["/v1/account/export"])).toEqual(["get"]);
    expect(Object.keys(doc.paths["/v1/account"])).toEqual(["delete"]);
    const exportSchema = doc.paths["/v1/account/export"].get.responses["200"].content["application/json"].schema;
    // Spec 19.0 AC35 adds the hevy block.
    expect(Object.keys(exportSchema.properties).sort()).toEqual(["exercises", "exportedAt", "formatVersion", "hevy", "profile", "routines", "workouts"]);
    const deleteSchema = doc.paths["/v1/account"].delete.responses["202"].content["application/json"].schema;
    expect(Object.keys(deleteSchema.properties).sort()).toEqual(["deletedAt", "purgeEligibleAt"]);
  });
});
