import { describeTimer, scoreText, type SectionScore, type SectionTimer } from "@sin/core";
import styles from "./sectionTimer.module.css";

export interface TimerLineProps {
  timer: SectionTimer;
  score?: SectionScore | null;
  className?: string;
}

/** Spec 10.7 AC7: the one plan (and score) line, from `@sin/core`'s `describeTimer` and `scoreText` only. */
export function TimerLine({ timer, score, className }: TimerLineProps) {
  const text = score ? `${describeTimer(timer)} · ${scoreText(score)}` : describeTimer(timer);
  return <p className={className ?? styles.line}>{text}</p>;
}
