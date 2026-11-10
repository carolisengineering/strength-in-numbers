// apps/api/test/unit/bench-login.test.ts
import { describe, expect, it } from "vitest";
import { assertMeasuringAsApp, benchLoginLine } from "../../scripts/lib/bench-login.js";
import type { RlsCatalogClient } from "../../src/db/rls.js";
import { RLS_TABLES } from "../../src/db/rls-tables.js";

/** A client that answers `current_user` with `login`, and the RLS read with `tablesOn` of the 19 tables on. */
const fake = (login: string, tablesOn: number) =>
  ({
    $queryRaw: (strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join("").includes("current_user")
          ? [{ login }]
          : RLS_TABLES.map((relname, i) => ({ relname, relrowsecurity: i < tablesOn })),
      ),
  }) as unknown as RlsCatalogClient;

describe("Spec 21.1 AC37, Review Focus 3 — a bench never quietly measures as the owner", () => {
  it("another login throws, and the message names it", async () => {
    await expect(assertMeasuringAsApp(fake("test", 19))).rejects.toThrow(/"test"/);
  });

  it("sin_app with 18 tables on throws", async () => {
    await expect(assertMeasuringAsApp(fake("sin_app", 18))).rejects.toThrow(/18\/19/);
  });

  it("sin_app with 19 tables on resolves, and the summary line prints both", async () => {
    const seen = await assertMeasuringAsApp(fake("sin_app", 19));
    expect(seen).toEqual({ login: "sin_app", rlsTablesOn: 19 });
    expect(benchLoginLine(seen)).toBe("login=sin_app rls=19/19");
  });
});
