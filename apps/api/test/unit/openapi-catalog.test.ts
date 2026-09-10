import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

/**
 * Spec 03.1 §10 AC10 — "Catalog routes are in the published contract." Two
 * views of the same document:
 *
 * 1. The live document `buildApp` serves at `/openapi.json` (what clients and
 *    Spec 03.0's meta-schema test see).
 * 2. The committed `<repo>/openapi.json`, which CI regenerates with
 *    `openapi:emit` and diffs (`git diff --exit-code`). Here we produce the same
 *    bytes in-process and compare, so a route-schema change that was not
 *    re-emitted fails locally, not just in CI.
 */

const COMMITTED_DOC = fileURLToPath(new URL("../../../../openapi.json", import.meta.url));

const CATALOG_PATHS = ["/v1/exercises", "/v1/muscle-groups", "/v1/equipment"] as const;

type Doc = {
  paths: Record<
    string,
    Record<
      string,
      {
        parameters?: { name: string; in: string; required?: boolean }[];
        responses: Record<
          string,
          { content?: Record<string, { schema: Record<string, unknown> }> }
        >;
      }
    >
  >;
};

const okSchema = (doc: Doc, path: string) =>
  doc.paths[path]!.get!.responses["200"]!.content!["application/json"]!.schema as {
    properties: Record<string, { items?: { properties: Record<string, unknown> } }>;
    required?: string[];
  };

const isCamelCase = (k: string) => /^[a-z][A-Za-z0-9]*$/.test(k) && !k.includes("_");

describe("AC10 — catalog routes are in the published OpenAPI contract", () => {
  it("the served document lists the three catalog GETs alongside /v1/me", async () => {
    const { app } = await buildTestApp();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as Doc;

    for (const path of CATALOG_PATHS) {
      expect(doc.paths, path).toHaveProperty(path);
      expect(Object.keys(doc.paths[path]!)).toEqual(["get"]);
    }
    expect(doc.paths).toHaveProperty("/v1/me");
  });

  it("every catalog response schema uses camelCase field names (DESIGN §6)", async () => {
    const { app } = await buildTestApp();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as Doc;

    const exercises = okSchema(doc, "/v1/exercises");
    expect(Object.keys(exercises.properties).sort()).toEqual(["exercises", "serverTime"]);
    const exerciseFields = Object.keys(exercises.properties.exercises!.items!.properties);
    expect(exerciseFields).toEqual(
      expect.arrayContaining([
        "id",
        "catalogKey",
        "ownerUserId",
        "name",
        "modality",
        "primaryMuscleId",
        "secondaryMuscleIds",
        "equipmentId",
        "isActive",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(exerciseFields.every(isCamelCase)).toBe(true);

    for (const [path, key] of [
      ["/v1/muscle-groups", "muscleGroups"],
      ["/v1/equipment", "equipment"],
    ] as const) {
      const schema = okSchema(doc, path);
      expect(Object.keys(schema.properties)).toEqual([key]);
      const fields = Object.keys(schema.properties[key]!.items!.properties);
      expect(fields).toEqual(expect.arrayContaining(["id", "name", "displayOrder"]));
      expect(fields.every(isCamelCase)).toBe(true);
    }
  });

  it("documents the optional updated_since query parameter on /v1/exercises", async () => {
    const { app } = await buildTestApp();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as Doc;

    const params = doc.paths["/v1/exercises"]!.get!.parameters ?? [];
    expect(params).toEqual([
      expect.objectContaining({ name: "updated_since", in: "query" }),
    ]);
    expect(params[0]!.required ?? false).toBe(false);
    expect(doc.paths["/v1/muscle-groups"]!.get!.parameters ?? []).toEqual([]);
    expect(doc.paths["/v1/equipment"]!.get!.parameters ?? []).toEqual([]);
  });

  it("the committed <repo>/openapi.json matches app.swagger() (CI drift check, run locally)", async () => {
    // Same call the emit script makes (`JSON.stringify(doc, null, 2) + "\n"`),
    // done in-process so the test never writes into the working tree.
    const { app } = await buildTestApp();
    await app.ready();
    const emitted = `${JSON.stringify(app.swagger(), null, 2)}\n`;
    const committed = readFileSync(COMMITTED_DOC, "utf8");

    expect(JSON.parse(emitted)).toEqual(JSON.parse(committed));
    expect(emitted).toBe(committed);
  });
});
