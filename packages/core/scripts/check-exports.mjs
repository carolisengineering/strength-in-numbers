#!/usr/bin/env node
/**
 * Post-build smoke (Spec 02 §2 AC1). Reads the package `exports` map and checks,
 * for the compiled `dist/`, that:
 *   - the `import` target loads and exposes the whole stable surface (§3);
 *   - the `types` target exists and is non-empty.
 * Runs as the second half of `pnpm --filter @sin/core build`, so a broken barrel,
 * a missing `.js` extension, or a `types` condition pointing at nothing fails the
 * build instead of a downstream consumer. Full consumer-side resolution (Node
 * conditions, `bundler` moduleResolution) is exercised for real once `apps/web`
 * imports `@sin/core` in Spec 04.
 */
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const root = pkg.exports["."];

function fail(msg) {
  console.error(`check-exports FAILED — ${msg}`);
  process.exit(1);
}

// --- types condition ---
if (!root.types) fail('package.json exports["."] has no "types" condition');
const typesUrl = new URL("../" + root.types, import.meta.url);
try {
  if (statSync(typesUrl).size === 0) fail(`${fileURLToPath(typesUrl)} is empty`);
} catch {
  fail(`types target ${fileURLToPath(typesUrl)} does not exist`);
}

// --- import condition ---
const importTarget = root.import ?? root.default;
if (!importTarget) fail('package.json exports["."] has no "import"/"default" condition');
const entry = new URL("../" + importTarget, import.meta.url);
const mod = await import(entry.href);

const EXPECTED = [
  // enums
  "UNIT_PREFERENCE_VALUES",
  "WEIGHT_UNIT_VALUES",
  "DISTANCE_UNIT_VALUES",
  "MODALITY_VALUES",
  "SET_TYPE_VALUES",
  "RECORD_TYPE_VALUES",
  // ids
  "brandId",
  "UserIdSchema",
  "parseUserId",
  "isUserId",
  // units
  "LB_TO_KG",
  "KM_TO_M",
  "MI_TO_M",
  "toCanonicalKg",
  "toCanonicalMeters",
  "kgToLb",
  "lbToKg",
  "kmToM",
  "mToKm",
  "miToM",
  "mToMi",
  // dto
  "MeSchema",
  "UpdateMeSchema",
];

const missing = EXPECTED.filter((name) => !(name in mod));
if (missing.length > 0) {
  fail(
    `${fileURLToPath(entry)} is missing:\n` + missing.map((m) => "  " + m).join("\n"),
  );
}
console.log(
  `check-exports passed — types + ${EXPECTED.length} runtime exports resolve.`,
);
