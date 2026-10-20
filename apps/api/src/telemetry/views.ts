import {
  AggregationType,
  createAllowListAttributesProcessor,
  type ViewOptions,
} from "@opentelemetry/sdk-metrics";

/**
 * Spec 13.0 §6.3 / §6.11 (D13 option 1). Each kept instrument gets a View that
 * (a) allowlists its attributes (AC8) and (b) renames it to a Prometheus-style
 * name that already ends in its unit, so the JS Prometheus exporter (no unit
 * suffixing) and Grafana Cloud's OTLP translation (adds the unit suffix only if
 * missing) yield the same series. Dashboards / alerts in ops/grafana/ query these
 * names — renaming one is a breaking change to them (§3).
 */
export const METRIC_NAMES = {
  httpDuration: "http_server_request_duration_seconds",
  eventLoopP99: "nodejs_eventloop_delay_p99_seconds",
  heapUsed: "v8js_memory_heap_used_bytes",
  gcDuration: "v8js_gc_duration_seconds",
  processStart: "sin_process_start_time_seconds",
  workoutsStarted: "sin_workouts_started",
  workoutsFinished: "sin_workouts_finished",
  setsLogged: "sin_sets_logged",
} as const;

const keep = (instrumentName: string, name: string, attrs: string[]): ViewOptions => ({
  instrumentName,
  name,
  attributesProcessors: [createAllowListAttributesProcessor(attrs)],
});

export function buildViews(): ViewOptions[] {
  return [
    keep("http.server.request.duration", METRIC_NAMES.httpDuration, [
      "http.request.method",
      "http.route",
      "http.response.status_code",
      "error.type",
    ]),
    keep("nodejs.eventloop.delay.p99", METRIC_NAMES.eventLoopP99, []),
    keep("v8js.memory.heap.used", METRIC_NAMES.heapUsed, ["v8js.heap.space.name"]),
    keep("v8js.gc.duration", METRIC_NAMES.gcDuration, ["v8js.gc.type"]),
    keep("sin.process.start_time", METRIC_NAMES.processStart, []),
    keep("sin.workouts.started", METRIC_NAMES.workoutsStarted, []),
    keep("sin.workouts.finished", METRIC_NAMES.workoutsFinished, []),
    keep("sin.sets.logged", METRIC_NAMES.setsLogged, ["modality"]),
    // Catch-all: every instrument also gets this stream, which is dropped. An
    // instrument with no `keep` View above therefore exports nothing (AC8).
    { instrumentName: "*", aggregation: { type: AggregationType.DROP } },
  ];
}
