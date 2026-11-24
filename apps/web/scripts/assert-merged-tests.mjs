/**
 * Issue 361 — every web test file is in the merged shard report. Run by the CI `web-coverage` job after
 * `test:merge`: a shard report that never arrived fails here instead of passing the coverage gates on a smaller
 * suite. `test:merge` writes the list as `.vitest-merged.json`, beside the shard reports and not among them (the
 * merge reads every file in their folder).
 *
 *   node apps/web/scripts/assert-merged-tests.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { missingTestFiles } from "./lib/merged-tests.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(WEB, ".vitest-merged.json");

/** Every file Vitest's `include` (`src/**\/*.test.{ts,tsx}`) picks up. */
const testFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry.name) ? [relative(WEB, path).replaceAll("\\", "/")] : [];
  });

let report;
try {
  report = JSON.parse(readFileSync(REPORT, "utf8"));
} catch (error) {
  process.stderr.write(`assert-merged-tests: FAIL — could not read ${relative(WEB, REPORT)} (${error instanceof Error ? error.message : "unknown error"}); run test:merge first\n`);
  process.exit(1);
}
const expected = testFiles(join(WEB, "src"));
const missing = missingTestFiles(expected, report, WEB);
if (expected.length === 0 || missing.length > 0) {
  process.stderr.write(`assert-merged-tests: FAIL — ${missing.length} of ${expected.length} test files are not in the merged report (a shard's report is missing):\n`);
  for (const file of missing) process.stderr.write(`  ${file}\n`);
  process.exit(1);
}
process.stdout.write(`assert-merged-tests: ok — all ${expected.length} test files are in the merged report\n`);
