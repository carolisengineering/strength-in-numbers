import { useId, type ReactNode } from "react";
import { sectionScore } from "@sin/core";
import { Button } from "../../ui/Button";
import { capLineShown } from "../sectionTimer/groupCap";
import { GROUP_CAP_LINE } from "../sectionTimer/timerCopy";
import { TimerLine } from "../sectionTimer/TimerLine";
import { timesLine } from "../sectionTimer/timesLine";
import type { SectionSegment, SectionTiming } from "./sectionSegments";
import { SECTION_COPY, editLabel, logResultLabel } from "./sections/sectionCopy";
import styles from "./SessionSectionHeading.module.css";

/**
 * Spec 10.7 AC23: a timed segment whose first 8 rows are one group and the 9th loose shows "Only the first 8
 * exercises are grouped." — only a timed section's first segment can, since only it carries `timing`.
 */
export function segmentCapLine(segment: SectionSegment): boolean {
  return segment.timing !== null && capLineShown(segment.rows.map((r) => r.exercise.supersetGroup));
}

export interface SessionSectionHeadingProps {
  id: string;
  heading: string;
  notes: string | null;
  /** Spec 10.6 AC1: renders the Edit button. Only the live and edit screens pass it — never the summary. */
  onEdit?: () => void;
  editRef?: (node: HTMLButtonElement | null) => void;
  /** Spec 10.7 AC19 / AC20: a timed section's plan, score and round times (its first segment only). */
  timing?: SectionTiming | null;
  /** Spec 10.7 AC19: renders the Log result button (the sheet is Phase C, so Phase B's screens pass none). */
  onLogResult?: () => void;
}

/**
 * The heading and, beneath it, a timed section's plan line, its times line and Log result (Spec 10.7 AC19), then
 * the section's note — full text, wrapped (Spec 10.3 AC24). Without `timing` the markup is the untimed heading's.
 */
export function SessionSectionHeading({ id, heading, notes, onEdit, editRef, timing, onLogResult }: SessionSectionHeadingProps) {
  const times = timing ? timesLine(timing.timer, timing.roundTimes) : null;
  return (
    <div className={styles.heading}>
      {onEdit ? (
        <div className={styles.row}>
          <h2 className={styles.name} id={id}>
            {heading}
          </h2>
          <Button variant="secondary" aria-label={editLabel(heading)} onClick={onEdit} ref={editRef}>
            {SECTION_COPY.edit}
          </Button>
        </div>
      ) : (
        <h2 className={styles.name} id={id}>
          {heading}
        </h2>
      )}
      {timing ? <TimerLine timer={timing.timer} score={sectionScore(timing)} className={styles.plan} /> : null}
      {times !== null ? <p className={styles.times}>{times}</p> : null}
      {timing && onLogResult ? (
        <div className={styles.logResult}>
          <Button variant="secondary" aria-label={logResultLabel(heading)} onClick={onLogResult}>
            {SECTION_COPY.logResult}
          </Button>
        </div>
      ) : null}
      {notes ? <p className={styles.notes}>{notes}</p> : null}
    </div>
  );
}

export interface SessionSectionProps {
  heading: string;
  notes: string | null;
  children: ReactNode;
  onEdit?: () => void;
  editRef?: (node: HTMLButtonElement | null) => void;
  /** Spec 10.6 AC2: shown in place of cards when `empty`. */
  emptyText?: string;
  /** The segment holds no exercises (minor 64: the caller knows from its rows; children are never inspected). */
  empty?: boolean;
  timing?: SectionTiming | null;
  onLogResult?: () => void;
  /** Spec 10.7 AC23: the muted "Only the first 8 exercises are grouped." line under the cards. */
  capLine?: boolean;
}

/** A labeled region: heading → note → cards, which is also the DOM (and so the reading) order (D10). */
export function SessionSection({ heading, notes, children, onEdit, editRef, emptyText, empty = false, timing, onLogResult, capLine = false }: SessionSectionProps) {
  const id = useId();
  const showEmpty = empty && emptyText !== undefined;
  return (
    <section className={styles.section} aria-labelledby={id}>
      <SessionSectionHeading id={id} heading={heading} notes={notes} onEdit={onEdit} editRef={editRef} timing={timing} onLogResult={onLogResult} />
      {showEmpty ? <p className={styles.empty}>{emptyText}</p> : children}
      {capLine ? <p className={styles.capLine}>{GROUP_CAP_LINE}</p> : null}
    </section>
  );
}
