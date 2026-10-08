import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import type { ProgressSeries } from "@sin/core";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { NotFound } from "../../screens/NotFound";
import { useMe } from "../me/useMe";
import { useExerciseRecords } from "../records/queries";
import { RecordsSection } from "../records/RecordsSection";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { ChoiceGroup } from "./ChoiceGroup";
import { formatLocalDateWithYear } from "./dates";
import { groupByExercise } from "./exercises";
import { LineChart } from "./LineChart";
import {
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
import styles from "./ExerciseProgressScreen.module.css";

/** Keys the screen by exercise so moving between exercises starts from defaults (§6.4). */
export function ExerciseProgressRoute() {
  const { exerciseId = "" } = useParams();
  return <ExerciseProgressScreen key={exerciseId} exerciseId={exerciseId} />;
}

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: RANGE_CHIP[r] }));

/**
 * One exercise's progress (Spec 08.1 §5.3). `chosen` and `selectedId` are preferences re-validated
 * against the data on every render — no effect-driven state sync (§6.4). `lastShown` keeps the last
 * real `{ range, series }` so a failed new range never blanks the chart or mislabels it (D8).
 */
export function ExerciseProgressScreen({ exerciseId }: { exerciseId: string }) {
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
  if (!view && failure && (failure.kind === "not-found" || failure.kind === "validation")) return <NotFound />;

  const name = records.data && records.data.length > 0 ? groupByExercise(records.data)[0]?.name : undefined;
  const available = availableMetrics(view?.series);
  const metric = resolveMetric(chosen, available);
  const points = pointsFor(view?.series, metric, pref);
  const selected = points.find((p) => p.id === selectedId) ?? points.at(-1);
  const busy = view !== null && view.range !== range && series.isFetching;
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
                {formatLocalDateWithYear(selected.localDate)} · {formatPointValue(selected, metric, pref)}
              </p>
              <Link className={styles.link} to={`/app/history/${encodeURIComponent(selected.id)}`}>
                Open workout
              </Link>
            </div>
            <p className={styles.caption}>{captionFor(metric, pref)}</p>
            <LineChart
              points={points}
              integer={metric === "reps"}
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
    <Screen title={name ?? "Exercise progress"}>
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
      <Link className={styles.back} to="/app/progress">
        Back to Progress
      </Link>
    </Screen>
  );
}
