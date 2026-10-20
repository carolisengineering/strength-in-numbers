import { metrics, type Counter, type Meter, type MeterProvider } from "@opentelemetry/api";

/**
 * Spec 13.0 §6.4 — business counters, incremented beside the existing
 * workout_started / workout_finished / set_created log events (D10). With the
 * SDK off the global provider is a no-op, so call sites need no guards.
 *
 * Instruments are re-created whenever the global MeterProvider changes: the
 * OTel API has no proxy meter, so instruments made before the SDK registers
 * would stay no-ops forever (and tests swap providers).
 */
const METER_NAME = "sin-api";

let cache: { provider: MeterProvider; started: Counter; finished: Counter; sets: Counter } | undefined;

function instruments() {
  const provider = metrics.getMeterProvider();
  if (cache?.provider !== provider) {
    const meter = provider.getMeter(METER_NAME);
    cache = {
      provider,
      started: meter.createCounter("sin.workouts.started", { description: "Workouts started (fresh creates only)" }),
      finished: meter.createCounter("sin.workouts.finished", { description: "Workouts finished" }),
      sets: meter.createCounter("sin.sets.logged", { description: "Sets logged, by exercise modality" }),
    };
  }
  return cache;
}

export function recordWorkoutStarted(): void {
  instruments().started.add(1);
}
export function recordWorkoutFinished(): void {
  instruments().finished.add(1);
}
/** `modality` is the set's modality snapshot — a fixed enum (bounded cardinality). */
export function recordSetLogged(modality: string): void {
  instruments().sets.add(1, { modality });
}

/** Restart annotations (§6.8): a constant per process; changes ⇒ the process restarted. */
export function registerProcessStartTime(meter: Meter, startSeconds = Math.round(Date.now() / 1000)): void {
  meter
    .createObservableGauge("sin.process.start_time", { description: "Process start time, Unix seconds" })
    .addCallback((r) => r.observe(startSeconds));
}
