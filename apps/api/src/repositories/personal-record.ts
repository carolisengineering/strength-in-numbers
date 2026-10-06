import type { RecordType, RecordUnit } from "@sin/core";

/** One personal record as the API layer sees it (Spec 07.0 §5). `value` /
 * `previousValue` are canonical units (kg, kg×reps, reps). */
export interface PersonalRecordRecord {
  /** The lineage root (§6.2). */
  exerciseId: string;
  sourceExerciseId: string;
  exerciseName: string;
  recordType: RecordType;
  value: number;
  unit: RecordUnit;
  previousValue: number | null;
  sourceSetId: string;
  workoutId: string;
  achievedAt: Date;
  /** YYYY-MM-DD. */
  localDate: string;
}

export interface PersonalRecordFilter {
  exerciseId?: string;
  workoutId?: string;
}

/** The read half (§6.7). Writes go through `recomputeRecordsForRoots`, which
 * takes a transaction client so finish / delete / rebuild share it (D22). */
export interface PersonalRecordRepository {
  /** Always scoped to `actingUserId`; unknown / foreign / unseen ids → [] (AC20). */
  list(actingUserId: string, filter: PersonalRecordFilter): Promise<PersonalRecordRecord[]>;
}
