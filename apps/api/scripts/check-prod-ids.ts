/**
 * Spec 15 AC24 — `infra/prod.tfvars` must hold real identifiers before anything is applied or deployed.
 *
 *   pnpm --filter @sin/api exec tsx scripts/check-prod-ids.ts --strict
 *
 * `--strict` (runbook Part F before the first `terraform apply`, and the deploy-prod gate) exits 1 while any
 * `REPLACE_ME_*` placeholder remains. Without it, it only lists them (CI accepts placeholders consistently).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { placeholderIds, prodOrigins } from "./lib/prod-ids.js";

const text = readFileSync(fileURLToPath(new URL("../../../infra/prod.tfvars", import.meta.url)), "utf8");
const strict = process.argv.includes("--strict");
const left = placeholderIds(text);
const { apiOrigin, webOrigin } = prodOrigins(text);
process.stdout.write(`check-prod-ids: API ${apiOrigin}\ncheck-prod-ids: web ${webOrigin}\n`);
if (left.length === 0) {
  process.stdout.write("check-prod-ids: ok — no placeholders\n");
} else if (strict) {
  process.stderr.write(`check-prod-ids: REFUSED — infra/prod.tfvars still holds placeholders: ${left.join(", ")} (runbook Part F)\n`);
  process.exit(1);
} else {
  process.stdout.write(`check-prod-ids: placeholders remain (${left.join(", ")}); fine for CI, refused with --strict\n`);
}
