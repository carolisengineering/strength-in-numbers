import { useId, useMemo, type Ref } from "react";
import { HEVY_IMPORT_DROP_CODES } from "@sin/core";
import { Link } from "react-router";

import { Button } from "../../../ui/Button";
import { HEVY_PATH } from "../paths";
import type { ImportState } from "./importSession";
import { aggregateResults, confirmLabel, sendable, summaryLists, type ListGroup } from "./importSummary";
import {
  BACK,
  BACK_TO_NAMES,
  CHECK_AGAIN,
  DONE,
  DROP_LABELS,
  exercisesCreatedLine,
  IMPORT_NOT_YET,
  LIST_GROUP_LABELS,
  NOTHING_NEW,
  NOTHING_WRITTEN,
  routinesChosenLine,
  setsLine,
  SUMMARY_LABELS,
  SUMMARY_STALE,
  SUMMARY_TITLE,
  unpairedLine,
  workoutsRead,
} from "./messages";
import { SummaryList } from "./SummaryList";
import styles from "./ImportScreen.module.css";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Spec 20.1 AC12–AC14, AC28, §5.5: what an import would do, from the dry run. Nothing is written here. In Phase A the
 * Import button is drawn disabled with `IMPORT_NOT_YET`; Phase B wires it.
 */
export function ImportSummaryView({
  state,
  zone,
  stale,
  onBack,
  onBackToNames,
  onCheckAgain,
  headingRef,
}: {
  state: ImportState;
  zone: string;
  stale: boolean;
  onBack: () => void;
  onBackToNames: () => void;
  onCheckAgain: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const results = useMemo(() => state.results ?? [], [state.results]);
  const agg = useMemo(() => aggregateResults(results, state.unreadable), [results, state.unreadable]);
  const lists = useMemo(() => (state.read === null ? [] : summaryLists(results, state.read.workouts, state.unreadable, zone)), [results, state.read, state.unreadable, zone]);
  const routineCount = state.picks.picked.size;
  const sendCount = sendable(results).length;
  const label = confirmLabel(agg, routineCount, sendCount);
  const nothing = label === NOTHING_NEW;
  const noteId = useId();
  const templateTitles = agg.unpairedTemplates.map((id) => state.read?.templates.get(id)?.title ?? id);

  const counts: [keyof typeof SUMMARY_LABELS, number][] = [
    ["create", agg.create],
    ["alreadyInSin", agg.alreadyInSin],
    ["duplicate", agg.duplicate],
    ["sentFromSin", agg.sentFromSin],
    ["deletedInSin", agg.deletedInSin],
    ["cannotImport", agg.cannotImport],
    ["unpaired", agg.unpaired],
  ];
  const groupLabel = (group: ListGroup, rows: number) =>
    group === "sets_dropped"
      ? `${LIST_GROUP_LABELS.sets_dropped} (${fmt(agg.setsDropped)} sets in ${fmt(rows)} ${rows === 1 ? "workout" : "workouts"})`
      : `${LIST_GROUP_LABELS[group]} (${fmt(rows)})`;

  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {SUMMARY_TITLE}
      </h2>
      {stale ? (
        <div className={styles.card} role="alert">
          <p className={styles.failure}>{SUMMARY_STALE}</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onCheckAgain}>
              {CHECK_AGAIN}
            </Button>
          </div>
        </div>
      ) : null}
      <p className={styles.text}>{workoutsRead(agg.read)}</p>
      <ul className={styles.list} aria-label={workoutsRead(agg.read)}>
        {counts
          .filter(([key, n]) => key === "create" || n > 0)
          .map(([key, n]) => (
            <li key={key}>
              {fmt(n)} {SUMMARY_LABELS[key]}
            </li>
          ))}
      </ul>
      {routineCount > 0 ? <p className={styles.text}>{routinesChosenLine(routineCount)}</p> : null}
      {state.exercisesCreated > 0 ? <p className={styles.text}>{exercisesCreatedLine(state.exercisesCreated)}</p> : null}
      <p className={styles.text}>{setsLine(agg.setsKept, agg.setsDropped)}</p>
      {HEVY_IMPORT_DROP_CODES.some((c) => agg.drops[c] > 0) ? (
        <ul className={styles.list}>
          {HEVY_IMPORT_DROP_CODES.filter((c) => agg.drops[c] > 0).map((c) => (
            <li key={c}>
              {DROP_LABELS[c]}: {fmt(agg.drops[c])}
            </li>
          ))}
        </ul>
      ) : null}
      {agg.unpaired > 0 ? (
        <div className={styles.card}>
          <p className={styles.text}>{unpairedLine(templateTitles.length)}</p>
          <ul className={styles.list}>
            {templateTitles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onBackToNames}>
              {BACK_TO_NAMES}
            </Button>
          </div>
        </div>
      ) : null}
      {lists.map((l) => (
        <SummaryList key={l.group} label={groupLabel(l.group, l.rows.length)} rows={l.rows} />
      ))}
      <p className={styles.muted}>{NOTHING_WRITTEN}</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onBack}>
          {BACK}
        </Button>
        {nothing ? (
          <>
            <p className={styles.text}>{NOTHING_NEW}</p>
            <Link className={styles.link} to={HEVY_PATH}>
              {DONE}
            </Link>
          </>
        ) : (
          <>
            <Button disabled aria-describedby={noteId}>
              {label}
            </Button>
            <p className={styles.muted} id={noteId}>
              {IMPORT_NOT_YET}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
