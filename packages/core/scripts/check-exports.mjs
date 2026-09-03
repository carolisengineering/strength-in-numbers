#!/usr/bin/env node
/**
 * Post-build smoke (Spec 02 §2 AC1): the compiled `dist/` actually resolves
 * through the package `exports` map and exposes the stable surface (§3). Runs as
 * the second half of `pnpm --filter @sin/core build`, so a broken barrel or a
 * missing `.js` extension fails the build instead of a downstream consumer.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const entry = new URL("../" + pkg.exports["."].default, import.meta.url);

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
  console.error(
    `check-exports FAILED — ${fileURLToPath(entry)} is missing:\n` +
      missing.map((m) => "  " + m).join("\n"),
  );
  process.exit(1);
}
console.log(`check-exports passed — ${EXPECTED.length} exports resolve.`);
