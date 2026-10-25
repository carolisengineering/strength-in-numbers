/**
 * Spec 15 AC22 — `apps/web/firebase.json` sends what `render.yaml`'s si-web-staging block sends, with the
 * production API origin (from `infra/prod.tfvars`) in place of staging's. Run by the CI `web` job.
 *
 *   node apps/web/scripts/assert-firebase-json.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFirebaseParity } from "./lib/firebase-parity.mjs";
import { parseTfvars, prodOrigins } from "./lib/prod-ids.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const renderYaml = read("render.yaml");
const tfvarsText = read("infra/prod.tfvars");
const staging = renderYaml.slice(renderYaml.indexOf("name: si-web-staging")).match(/key: VITE_API_BASE_URL\s*\n\s*value:\s*(\S+)/);
if (!staging) {
  process.stderr.write("assert-firebase-json: could not read si-web-staging's VITE_API_BASE_URL from render.yaml\n");
  process.exit(1);
}
const problems = checkFirebaseParity({
  renderYaml,
  firebaseJson: read("apps/web/firebase.json"),
  prodApiOrigin: prodOrigins(tfvarsText).apiOrigin,
  stagingApiOrigin: staging[1],
  siteId: parseTfvars(tfvarsText).hosting_site_id,
});
for (const problem of problems) process.stderr.write(`assert-firebase-json: FAIL — ${problem}\n`);
process.stdout.write(problems.length === 0 ? "assert-firebase-json: PASS\n" : "");
process.exit(problems.length === 0 ? 0 : 1);
