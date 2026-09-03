/**
 * @sin/core — framework-agnostic domain package.
 *
 * Hard rule (DESIGN.md §3.4, §7): no React, no DOM, no Node-only APIs in this
 * package. Enforced by scripts/purity-check.mjs, run in CI and the test suite.
 *
 * Spec 02 ships the foundation: shared enums, branded ids, unit conversion, and
 * the `/v1/me` DTO as the pattern later DTOs copy. Domain math (e1RM, volume, PR
 * rules) arrives with the feature specs that use it (05, 07); the OpenAPI→types
 * codegen seam arrives with Spec 03.
 */

export * from "./enums.js";
export * from "./ids.js";
export * from "./units.js";
export * from "./dto/me.js";
