import { describe, expect, it } from "vitest";
import { PersonalRecordsResponseSchema } from "@sin/core";
import { makePersonalRecord } from "../../test/workoutFixtures";
import { createRecordsClient } from "./recordsClient";

function recordingApi(body: unknown) {
  const calls: { path: string; schema: unknown }[] = [];
  const api = {
    get: async (path: string, schema?: { parse: (x: unknown) => unknown }) => {
      calls.push({ path, schema });
      return schema ? schema.parse(body) : body;
    },
  };
  return { api: api as Parameters<typeof createRecordsClient>[0], calls };
}

describe("08.0 AC4 — the records client builds the right request", () => {
  it("sends exactly the filters given and returns the records", async () => {
    const record = makePersonalRecord();
    const { api, calls } = recordingApi({ records: [record] });
    const client = createRecordsClient(api);

    expect(await client.listRecords({ workoutId: "w-1" })).toEqual([record]);
    await client.listRecords({ exerciseId: "e-1" });
    await client.listRecords({});

    expect(calls.map((c) => c.path)).toEqual([
      "/v1/personal-records?workoutId=w-1",
      "/v1/personal-records?exerciseId=e-1",
      "/v1/personal-records",
    ]);
    expect(calls[0]!.schema).toBe(PersonalRecordsResponseSchema);
  });

  it("encodes ids so they cannot change the path or add a parameter", async () => {
    const { api, calls } = recordingApi({ records: [] });
    await createRecordsClient(api).listRecords({ workoutId: "a/b?c#d&exerciseId=x" });

    const url = new URL(`https://api.example.test${calls[0]!.path}`);
    expect(url.pathname).toBe("/v1/personal-records");
    expect([...url.searchParams.entries()]).toEqual([["workoutId", "a/b?c#d&exerciseId=x"]]);
  });
});
