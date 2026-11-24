/**
 * The web suite's coverage settings that have rules of their own (read by ./vitest.config.ts; kept free of Vite
 * imports so a test can load it).
 */

/**
 * Istanbul, not V8: V8 recorded most .tsx files as one statement on line 1, so the gates below couldn't see a
 * component's untested lines and coverage from separate CI shards couldn't be added up (issue 361).
 */
export const COVERAGE_PROVIDER = "istanbul" as const;

// Spec 04.0 §10 — the security-load-bearing modules are held at >= 90%
// line coverage (the browser analogue of Spec 01's auth-plugin gate).
// Spec 06.0 AC31 adds the catalog client and the storage seam: a silent
// bug there (a reset loop, a leaked forked origin, a storage failure
// that crashes the app) is user-visible and hard to diagnose.
// Spec 06.1 AC36 adds the workout screen: a bug in set logging loses a
// lifter's data, and the failure matrix is the part that rots.
export const COVERAGE_GATES: Readonly<Record<string, { lines: number }>> = {
  "src/api/**": { lines: 90 },
  "src/auth/**": { lines: 90 },
  "src/features/catalog/**": { lines: 90 },
  "src/features/workouts/**": { lines: 90 },
  // Spec 06.2 AC20: the outbox decides whether a lifter's set reaches the server.
  "src/features/workouts/outbox/**": { lines: 90 },
  "src/storage/**": { lines: 90 },
  // Spec 06.5 AC26: the drafts store and the sign-out guard decide whether typing or sets are lost.
  "src/features/workouts/drafts/**": { lines: 90 },
  "src/features/workouts/logoutGuard.ts": { lines: 90 },
  // Spec 17.1 §10: the current-exercise rules decide where the lifter's next tap lands.
  "src/features/workouts/currentExercise.ts": { lines: 90 },
  // Spec 17.1 §10: the rest store decides what a reload shows mid-rest.
  "src/features/workouts/restStore.ts": { lines: 90 },
};

/**
 * Issue 361: CI runs the suite in shards (`test:shard`, with SIN_WEB_SHARD=1) and one job merges their coverage
 * (`test:merge`). A shard sees a fraction of the suite, so it has no gates; the merge and a local `test:coverage`
 * have all of them. Only the exact value "1" is the switch.
 */
export function coverageGates(env: { SIN_WEB_SHARD?: string | undefined }): Readonly<Record<string, { lines: number }>> | undefined {
  return env.SIN_WEB_SHARD === "1" ? undefined : COVERAGE_GATES;
}
