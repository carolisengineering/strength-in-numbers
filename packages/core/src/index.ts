/**
 * @sin/core — framework-agnostic domain package.
 *
 * Spec 01 ships this as a stub only. Real contents (DTO types, Zod schemas,
 * units / e1RM / volume / PR math) arrive in Spec 02 and the feature specs.
 *
 * Hard rule (DESIGN.md §3.4): no React, no DOM, no Node-only APIs in this
 * package. Enforced by scripts/purity-check.mjs, run in CI.
 */

export const CORE_PACKAGE_VERSION = "0.0.0" as const;
