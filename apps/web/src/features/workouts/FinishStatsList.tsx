import { formatVolumeKg } from "../units/format";
import styles from "./FinishStatsList.module.css";
import { formatMinutes, type FinishStatsValue } from "./finishStats";

/**
 * Spec 17.2 AC12: what the lifter did, as figures over small labels: duration, exercises, working sets and, when a set
 * qualifies, volume. Shared by both Finish dialogs and the summary header so they cannot disagree. Static: no motion, no
 * live region (AC13).
 */
export function FinishStats({ stats, unitPreference }: { stats: FinishStatsValue; unitPreference: "kg" | "lb" }) {
  const items: { value: string; label: string }[] = [
    { value: formatMinutes(stats.minutes), label: "duration" },
    { value: String(stats.exercises), label: "exercises" },
    { value: String(stats.sets), label: "sets" },
  ];
  if (stats.volumeKg !== null) items.push({ value: formatVolumeKg(stats.volumeKg, unitPreference), label: "volume" });
  return (
    <ul className={styles.stats}>
      {items.map((item) => (
        <li key={item.label} className={styles.stat}>
          <span className={styles.value}>{item.value}</span>
          <span className={styles.label}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
