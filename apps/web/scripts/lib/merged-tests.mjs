/**
 * Issue 361 — the check behind `assert-merged-tests.mjs` (pure). CI runs the web suite in shards and merges their
 * reports; the 90% coverage gates are applied to the merge. A shard report that never arrived would leave the merge
 * with fewer tests and less code to hold to the gates, and nothing else would notice.
 */

/**
 * The test files on disk that the merged report doesn't hold, sorted.
 *
 * @param {readonly string[]} expected test files, relative to the web package (`src/a.test.ts`)
 * @param {{ testResults?: readonly { name?: string }[] }} report Vitest's JSON report of the merge (absolute names)
 * @param {string} root the web package's absolute path on the machine that ran the shards
 * @returns {string[]}
 */
export function missingTestFiles(expected, report, root) {
  const base = root.replaceAll("\\", "/").replace(/\/+$/, "");
  const ran = new Set((report?.testResults ?? []).map((result) => String(result?.name ?? "").replaceAll("\\", "/")));
  return expected.filter((file) => !ran.has(`${base}/${file}`)).sort();
}
