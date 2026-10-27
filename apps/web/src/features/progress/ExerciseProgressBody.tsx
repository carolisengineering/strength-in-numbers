import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { ProgressSeries } from "@sin/core";
import { InlineNotice } from "../../ui/InlineNotice";
import { useMe } from "../me/useMe";
import { useExerciseRecords } from "../records/queries";
import { RecordsSection } from "../records/RecordsSection";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { ChoiceGroup } from "./ChoiceGroup";
import { formatLocalDateWithYear } from "./dates";
import { LineChart } from "./LineChart";
import {
  INTEGER_METRICS,
  METRICS,
  availableMetrics,
  captionFor,
  chartSummary,
  formatPointValue,
  pointsFor,
  resolveMetric,
  type Metric,
} from "./metrics";
import { useSeries } from "./queries";
import { RANGES, RANGE_CHIP, emptyRangeText, rangeLabel, type Range } from "./range";
import styles from "./ExerciseProgressBody.module.css";

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: RANGE_CHIP[r] }));

/**
 * One exercise's progress (Spec 08.1 §5.3), drawn under the exercise page (Spec 18.2 AC23): the page owns
 * the title, the back link and the gone rule; this body is the controls, the chart and the records. `chosen` and `selectedId` are preferences re-validated
 * against the data on every render — no effect-driven state sync (§6.4). `lastShown` keeps the last
 * real `{ range, series }` so a failed new range never blanks the chart or mislabels it (D8).
 */
export function ExerciseProgressBody({ exerciseId }: { exerciseId: string }) {
  const { data: me } = useMe();
  const pref = me?.unitPreference ?? "kg";
  const [range, setRange] = useState<Range>("3m");
  const [chosen, setChosen] = useState<Metric | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const series = useSeries(exerciseId, range);
  const records = useExerciseRecords(exerciseId);
  const lastShown = useRef<{ range: Range; series: ProgressSeries } | null>(null);

  useEffect(() => {
    if (series.data && !series.isPlaceholderData) lastShown.current = { range, series: series.data };
  }, [series.data, series.isPlaceholderData, range]);

  useEffect(() => {
    if (series.error) reportUnexpected("load-progress-series", series.error);
  }, [series.error]);

  const view: { range: Range; series: ProgressSeries } | null =
    series.data && !series.isPlaceholderData
      ? { range, series: series.data }
      : series.data
        ? (lastShown.current ?? { range, series: series.data })
        : lastShown.current;

  const failure = series.error ? classifyWorkoutError(series.error, { op: "load-progress-series" }) : null;
  const available = availableMetrics(view?.series);
  const metric = resolveMetric(chosen, available);
  const points = pointsFor(view?.series, metric, pref);
  const selected = points.find((p) => p.id === selectedId) ?? points.at(-1);
  // A shown range that differs from the chosen one is always announced: a status while it loads, the notice once it fails.
  const busy = view !== null && view.range !== range && !failure;
  const retry = () => void series.refetch();

  let chartArea;
  if (!view) {
    chartArea = failure ? (
      <InlineNotice tone="error" requestId={failure.requestId} actionLabel="Try again" onAction={retry}>
        Couldn't load this chart
      </InlineNotice>
    ) : (
      <p role="status" className={styles.status}>
        Loading chart…
      </p>
    );
  } else {
    const notice =
      failure && view.range !== range ? (
        <InlineNotice tone="error" requestId={failure.requestId} actionLabel="Try again" onAction={retry}>
          Couldn't load {rangeLabel(range)}
        </InlineNotice>
      ) : series.isRefetchError ? (
        <InlineNotice tone="error" requestId={failure?.requestId ?? null} actionLabel="Try again" onAction={retry}>
          Couldn't refresh this chart
        </InlineNotice>
      ) : null;
    chartArea = (
      <>
        {notice}
        {view.series.points.length === 0 ? (
          <p>{emptyRangeText(view.range)}</p>
        ) : !metric || !selected ? (
          <p>Nothing to chart for this exercise yet</p>
        ) : (
          <>
            <div className={styles.readoutRow}>
              <p className={styles.readout} aria-live="polite" aria-atomic="true">
                {formatLocalDateWithYear(selected.localDate)} ·{" "}
                <strong className={styles.readoutValue}>{formatPointValue(selected, metric, pref)}</strong>
              </p>
              <Link className={styles.link} to={`/app/history/${encodeURIComponent(selected.id)}`}>
                Open workout
              </Link>
            </div>
            <p className={styles.caption}>{captionFor(metric, pref)}</p>
            <LineChart
              points={points}
              integer={INTEGER_METRICS.has(metric)}
              selectedId={selected.id}
              onSelect={setSelectedId}
              summary={chartSummary({ metric, range: view.range, points, pref })}
            />
            <ul className={styles.sessions} aria-label="Sessions">
              {[...points].reverse().map((p) => (
                <li key={p.id}>
                  <button type="button" className={styles.session} aria-pressed={p.id === selected.id} onClick={() => setSelectedId(p.id)}>
                    {formatLocalDateWithYear(p.localDate)} · {formatPointValue(p, metric, pref)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div className={styles.controls}>
        {metric ? (
          <ChoiceGroup
            label="Metric"
            options={available.map((m) => ({ value: m, label: METRICS[m].label }))}
            value={metric}
            onChange={setChosen}
          />
        ) : null}
        <ChoiceGroup label="Range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
      </div>
      <div className={styles.chartArea} aria-busy={busy ? "true" : undefined}>
        {busy ? (
          <p role="status" className={styles.status}>
            Loading {rangeLabel(range)}…
          </p>
        ) : null}
        {chartArea}
      </div>
      <RecordsSection query={records} unitPreference={pref} />
    </>
  );
}
