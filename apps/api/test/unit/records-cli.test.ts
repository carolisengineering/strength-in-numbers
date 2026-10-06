import { describe, expect, it } from "vitest";
import { main } from "../../src/records/cli.js";

const QUIET = { LOG_LEVEL: "silent" };

describe("AC22 — records:rebuild CLI argument handling (no database touched)", () => {
  it("exits 1 without DATABASE_URL", async () => {
    await expect(main([], { ...QUIET })).resolves.toBe(1);
  });
  it("exits 1 on --user with no value or a malformed id", async () => {
    const env = { ...QUIET, DATABASE_URL: "postgresql://u:p@localhost:5432/sin" };
    await expect(main(["--user"], env)).resolves.toBe(1);
    await expect(main(["--user", "not-a-uuid"], env)).resolves.toBe(1);
  });
});
