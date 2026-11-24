import { describe, expect, it } from "vitest";
import { missingTestFiles } from "../../../web/scripts/lib/merged-tests.mjs";

/** Issue 361: the web coverage job merges sixteen shard reports; a lost report would pass the gates on less code. */
describe("issue 361 — the merged web report holds every test file", () => {
  const root = "/home/runner/work/repo/repo/apps/web";
  const report = (...names: string[]) => ({ testResults: names.map((name) => ({ name })) });
  it("nothing is missing when every test file on disk is in the report", () => {
    expect(missingTestFiles(["src/a.test.ts", "src/ui/b.test.tsx"], report(`${root}/src/a.test.ts`, `${root}/src/ui/b.test.tsx`), root)).toEqual([]);
  });
  it("names the files a lost shard report would have held, sorted", () => {
    expect(missingTestFiles(["src/z.test.ts", "src/a.test.ts", "src/m.test.tsx"], report(`${root}/src/m.test.tsx`), root)).toEqual(["src/a.test.ts", "src/z.test.ts"]);
  });
  it("a file with the same name in another folder doesn't stand in for a missing one", () => {
    expect(missingTestFiles(["src/a/x.test.ts", "src/b/x.test.ts"], report(`${root}/src/a/x.test.ts`), root)).toEqual(["src/b/x.test.ts"]);
  });
  it("an empty or malformed report means every file is missing", () => {
    expect(missingTestFiles(["src/a.test.ts"], {}, root)).toEqual(["src/a.test.ts"]);
    expect(missingTestFiles(["src/a.test.ts"], { testResults: [] }, root)).toEqual(["src/a.test.ts"]);
  });
});
