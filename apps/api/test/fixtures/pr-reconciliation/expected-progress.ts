/**
 * Spec 07.2 AC18 — the progress series of each fixture lineage, worked BY HAND
 * from sessions.ts. Chronological order: S1(d1) S4(d2) S2(d3) S3(d5) S5(d7)
 * S6(d8) S7(d9) S8(d10) S9(d11) S10(d12); local_date = 2026-09-<day>.
 * Values are milli-decimal strings (milliToDecimalString) or null.
 * Epley half-up: floor((w_milli × (30 + reps) + 15) / 30).
 */
export interface ExpectedPoint {
  session: string;
  localDate: string;
  topSetWeight: string | null;
  bestE1rm: string | null;
  totalVolume: string | null;
  maxReps: string | null;
}

export const EXPECTED_PROGRESS: Record<"bench" | "squat" | "dips" | "pullup", ExpectedPoint[]> = {
  // bench lineage (bench + benchFork). S6's bench sets are a failure set only → no point.
  bench: [
    // S1: 100×5, 100×5 (warm-up 140×3 excluded) → top 100; e1RM 3500015/30 → 116.667; volume 500 + 500
    { session: "S1", localDate: "2026-09-01", topSetWeight: "100.000", bestE1rm: "116.667", totalVolume: "1000.000", maxReps: null },
    // S4: 105×1 → e1RM 3255015/30 → 108.500; volume 105
    { session: "S4", localDate: "2026-09-02", topSetWeight: "105.000", bestE1rm: "108.500", totalVolume: "105.000", maxReps: null },
    // S2: 102.5×3 → e1RM 3382515/30 → 112.750; volume 307.5
    { session: "S2", localDate: "2026-09-03", topSetWeight: "102.500", bestE1rm: "112.750", totalVolume: "307.500", maxReps: null },
    // S3 (fork): 102.5×5 → e1RM 3587515/30 → 119.583; volume 512.5
    { session: "S3", localDate: "2026-09-05", topSetWeight: "102.500", bestE1rm: "119.583", totalVolume: "512.500", maxReps: null },
    // S7 (fork): 100×8 → e1RM 3800015/30 → 126.667; volume 800
    { session: "S7", localDate: "2026-09-09", topSetWeight: "100.000", bestE1rm: "126.667", totalVolume: "800.000", maxReps: null },
    // S10: 102.5×5 → 119.583; volume 512.5
    { session: "S10", localDate: "2026-09-12", topSetWeight: "102.500", bestE1rm: "119.583", totalVolume: "512.500", maxReps: null },
  ],
  squat: [
    // S1: 225 lb → weight_kg 102.058 ×5 → e1RM 102058×35+15 = 3572045/30 → 119.068; volume 510.290
    { session: "S1", localDate: "2026-09-01", topSetWeight: "102.058", bestE1rm: "119.068", totalVolume: "510.290", maxReps: null },
    // S4: 100×8 → 126.667; volume 800
    { session: "S4", localDate: "2026-09-02", topSetWeight: "100.000", bestE1rm: "126.667", totalVolume: "800.000", maxReps: null },
    // S5: 110×13 → no e1RM (13 reps); volume 1430
    { session: "S5", localDate: "2026-09-07", topSetWeight: "110.000", bestE1rm: null, totalVolume: "1430.000", maxReps: null },
    // S9: 105×10 → 4200015/30 → 140.000; volume 1050
    { session: "S9", localDate: "2026-09-11", topSetWeight: "105.000", bestE1rm: "140.000", totalVolume: "1050.000", maxReps: null },
  ],
  dips: [
    // S3: 20×8 → 760015/30 → 25.333; volume 160
    { session: "S3", localDate: "2026-09-05", topSetWeight: "20.000", bestE1rm: "25.333", totalVolume: "160.000", maxReps: null },
    // S5: 25×5 → 875015/30 → 29.167; volume 125
    { session: "S5", localDate: "2026-09-07", topSetWeight: "25.000", bestE1rm: "29.167", totalVolume: "125.000", maxReps: null },
    // S8: 20×10 → 800015/30 → 26.667; volume 200
    { session: "S8", localDate: "2026-09-10", topSetWeight: "20.000", bestE1rm: "26.667", totalVolume: "200.000", maxReps: null },
  ],
  pullup: [
    // S2: 8, 10 → maxReps 10 (as milli-decimal "10.000")
    { session: "S2", localDate: "2026-09-03", topSetWeight: null, bestE1rm: null, totalVolume: null, maxReps: "10.000" },
    { session: "S6", localDate: "2026-09-08", topSetWeight: null, bestE1rm: null, totalVolume: null, maxReps: "12.000" },
    { session: "S10", localDate: "2026-09-12", topSetWeight: null, bestE1rm: null, totalVolume: null, maxReps: "12.000" },
  ],
};
// Series max vs expected.ts (AC18): bench top 105.000 = heaviest_weight; bench e1RM 126.667 = best_est_1rm;
// squat 110.000 / 140.000; dips 25.000 / 29.167; pullup maxReps 12.000 = max_reps.
// Volume is outside the guarantee: bench max session volume 1000.000 (S1) ≠ best_set_volume 800.000 (S7).
