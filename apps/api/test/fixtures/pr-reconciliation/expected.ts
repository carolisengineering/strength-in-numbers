/**
 * Spec 07.0 AC26 — expected records for sessions.ts, worked BY HAND from spec
 * §6.1. Never regenerate this file from the code's output: it exists to be an
 * independent check (M2's exit criterion — progress numbers reconciled by hand).
 *
 * Epley half-up: floor((w_milli × (30 + reps) + 15) / 30). 225 lb =
 * 102.05828325 kg, stored by numeric(7,3) as 102.058.
 * Chronological order: S1(d1) S4(d2) S2(d3) S3(d5) S5(d7) S6(d8) S7(d9)
 * S8(d10) S9(d11) S10(d12).
 */
export interface Expected {
  exercise: "bench" | "squat" | "dips" | "pullup";
  recordType: string;
  value: string;
  previousValue: string | null;
  session: string;
}

export const EXPECTED: Expected[] = [
  // bench lineage = bench + benchFork. Working sets: S1 100×5 100×5 | S4 105×1 | S2 102.5×3 | S3 102.5×5 | S7 100×8 | S10 102.5×5
  // (S1's 140 warm-up and S6's 120 failure set are excluded.)
  // heaviest: S1 100 → S4 105 beats it; nothing later reaches 105.
  { exercise: "bench", recordType: "heaviest_weight", value: "105.000", previousValue: "100.000", session: "S4" },
  // e1RM: S1 100×5 = (3500000+15)/30 → 116667; S4 105×1 = 3255015/30 → 108500; S2 102.5×3 = 3382515/30 → 112750;
  //       S3 102.5×5 = 3587515/30 → 119583 (beats 116667); S7 100×8 = 3800015/30 → 126667 (beats 119583); S10 → 119583.
  { exercise: "bench", recordType: "best_est_1rm", value: "126.667", previousValue: "119.583", session: "S7" },
  // volume: S1 500, S4 105, S2 307.5, S3 512.5 (beats 500), S7 800 (beats 512.5), S10 512.5.
  { exercise: "bench", recordType: "best_set_volume", value: "800.000", previousValue: "512.500", session: "S7" },

  // squat: S1 102.058×5 | S4 100×8 | S5 110×13 | S9 105×10
  // heaviest: S1 102.058 → S5 110 beats it.
  { exercise: "squat", recordType: "heaviest_weight", value: "110.000", previousValue: "102.058", session: "S5" },
  // e1RM: S1 102058×35 = 3572030+15 → /30 = 119068; S4 100×8 → 126667 (beats); S5 13 reps → none;
  //       S9 105×10 = 4200015/30 → 140000 (beats 126667).
  { exercise: "squat", recordType: "best_est_1rm", value: "140.000", previousValue: "126.667", session: "S9" },
  // volume: S1 510.290, S4 800 (beats), S5 1430 (beats 800), S9 1050.
  { exercise: "squat", recordType: "best_set_volume", value: "1430.000", previousValue: "800.000", session: "S5" },

  // dips (weighted_bodyweight, added load only): S3 20×8 | S5 25×5 | S8 20×10
  { exercise: "dips", recordType: "heaviest_weight", value: "25.000", previousValue: "20.000", session: "S5" },
  // e1RM: S3 20000×38+15 = 760015/30 → 25333; S5 25000×35+15 = 875015/30 → 29167 (beats); S8 800015/30 → 26667.
  { exercise: "dips", recordType: "best_est_1rm", value: "29.167", previousValue: "25.333", session: "S5" },
  // volume: S3 160, S5 125, S8 200 (beats 160).
  { exercise: "dips", recordType: "best_set_volume", value: "200.000", previousValue: "160.000", session: "S8" },

  // pullup (bodyweight_reps): S2 8, 10 → 10 | S6 12 (beats) | S10 12 (tie — the earlier S6 keeps it).
  { exercise: "pullup", recordType: "max_reps", value: "12.000", previousValue: "10.000", session: "S6" },
];
