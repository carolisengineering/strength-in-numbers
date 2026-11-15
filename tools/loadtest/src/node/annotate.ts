/**
 * Spec 16 AC25 — every staging / prod run leaves a Grafana annotation over its window, tagged `loadtest`, the target
 * and the run type, so the usage panels can be read around test traffic (§6.8). Both calls never throw: a failure is
 * one warning line naming the step (never the token) and the run goes on.
 */
import type { Secrets } from "./env.ts";
import { callSignal } from "./http-limits.ts";

export interface AnnotationStart {
  target: string;
  type: string;
  startMs: number;
}

export interface AnnotationEnd {
  endMs: number;
  text: string;
}

async function call(
  s: Secrets,
  step: "opening" | "closing",
  method: "POST" | "PATCH",
  path: string,
  body: Record<string, unknown>,
  fetchFn: typeof fetch,
  warn: (line: string) => void,
): Promise<Response | undefined> {
  let why: string;
  try {
    const res = await fetchFn(`${s.get("GRAFANA_URL").replace(/\/+$/, "")}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${s.get("GRAFANA_ANNOTATION_TOKEN")}` },
      body: JSON.stringify(body),
      signal: callSignal(),
    });
    if (res.ok) return res;
    why = `HTTP ${res.status}`;
  } catch {
    why = "network error";
  }
  warn(`Grafana annotation: ${step} the run annotation failed (${why}); the run goes on`);
  return undefined;
}

export async function openAnnotation(
  s: Secrets,
  a: AnnotationStart,
  fetchFn: typeof fetch,
  warn: (line: string) => void,
): Promise<number | undefined> {
  const res = await call(
    s,
    "opening",
    "POST",
    "/api/annotations",
    { time: a.startMs, tags: ["loadtest", a.target, a.type], text: `load test: ${a.type} run on ${a.target}` },
    fetchFn,
    warn,
  );
  if (!res) return undefined;
  const body = (await res.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id === "number") return body.id;
  warn("Grafana annotation: opening the run annotation failed (no id in the answer); the run goes on");
  return undefined;
}

export async function closeAnnotation(
  s: Secrets,
  id: number | undefined,
  a: AnnotationEnd,
  fetchFn: typeof fetch,
  warn: (line: string) => void,
): Promise<void> {
  if (id === undefined) return;
  await call(s, "closing", "PATCH", `/api/annotations/${id}`, { timeEnd: a.endMs, text: a.text }, fetchFn, warn);
}
