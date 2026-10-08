import type { UnitPreference } from "@sin/core";
import { useWorkoutRecords } from "./queries";
import { RecordsSection } from "./RecordsSection";

/** The records this workout holds now (Spec 08.0 §5.3, D14): 08.0's block over the shared section (08.1 D13). */
export function PersonalRecordsBlock({ workoutId, unitPreference }: { workoutId: string; unitPreference: UnitPreference }) {
  const query = useWorkoutRecords(workoutId);
  return <RecordsSection query={query} unitPreference={unitPreference} />;
}
