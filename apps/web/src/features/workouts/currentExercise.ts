/**
 * Spec 17.1 §6.1–§6.2: which exercise is "current". Pure: no React, no DOM. The rows are `supersetRows` output
 * (display order, run links, section-aware); progress is positional (`sets.length` against `plannedSets.length`,
 * queued and failed sets included, 10.2 D2), never `setNumber`. Superset runs come only from `linkedBelow`,
 * never from the stored `supersetGroup` (AC15).
 */
export interface CurrentRow {
  readonly exercise: {
    readonly id: string;
    readonly plannedSets: readonly unknown[];
    readonly sets: readonly { readonly createdAt: string }[];
  };
  readonly linkedBelow: boolean;
}

export interface Progress {
  readonly planned: number;
  readonly logged: number;
  readonly remaining: number;
  /** No plan: a manual add or a pre-0010 workout. */
  readonly open: boolean;
}

export function progressOf(exercise: CurrentRow["exercise"]): Progress {
  const planned = exercise.plannedSets.length;
  const logged = exercise.sets.length;
  return { planned, logged, remaining: Math.max(planned - logged, 0), open: planned === 0 };
}

const hasRemaining = (row: CurrentRow): boolean => progressOf(row.exercise).remaining > 0;

/** The maximal chain of `linkedBelow` rows holding `id`, or `null` when it sits in no run. */
export function runOf<R extends CurrentRow>(rows: readonly R[], id: string): readonly R[] | null {
  const at = rows.findIndex((r) => r.exercise.id === id);
  if (at < 0) return null;
  let start = at;
  while (start > 0 && rows[start - 1]!.linkedBelow) start -= 1;
  let end = at;
  while (end < rows.length - 1 && rows[end]!.linkedBelow) end += 1;
  return end > start ? rows.slice(start, end + 1) : null;
}

/** The exercise holding the most recently created set; on a tie, the later one in display order. */
export function lastLoggedId(rows: readonly CurrentRow[]): string | null {
  let best: { id: string; at: number } | null = null;
  for (const row of rows) {
    for (const set of row.exercise.sets) {
      const at = Date.parse(set.createdAt);
      if (best === null || at >= best.at) best = { id: row.exercise.id, at };
    }
  }
  return best?.id ?? null;
}

/** §6.2 step 3: the first exercise after index `from` with a planned set left, wrapping; entered at its run's first such member. */
function nextWithRemaining(rows: readonly CurrentRow[], from: number): string | null {
  for (let step = 1; step < rows.length; step += 1) {
    const row = rows[(from + step) % rows.length]!;
    if (!hasRemaining(row)) continue;
    const run = runOf(rows, row.exercise.id);
    return (run?.find(hasRemaining) ?? row).exercise.id;
  }
  return null;
}

/** §6.2 "Advancing": where current goes after a set was logged on `loggedId` (`rows` already hold that set). */
export function advanceAfterLog({ rows, loggedId, wasExtra }: { rows: readonly CurrentRow[]; loggedId: string; wasExtra: boolean }): string {
  const at = rows.findIndex((r) => r.exercise.id === loggedId);
  if (at < 0) return loggedId;
  const run = runOf(rows, loggedId);
  if (run !== null) {
    const k = run.findIndex((r) => r.exercise.id === loggedId);
    for (let step = 1; step <= run.length; step += 1) {
      const member = run[(k + step) % run.length]!;
      if (hasRemaining(member)) return member.exercise.id;
    }
    return nextWithRemaining(rows, rows.indexOf(run[run.length - 1]!)) ?? loggedId;
  }
  const progress = progressOf(rows[at]!.exercise);
  if (wasExtra || progress.open || progress.remaining > 0) return loggedId;
  return nextWithRemaining(rows, at) ?? loggedId;
}

/** §6.2 "Choosing": the default current, from the workout alone (a reload, a first render). */
export function chooseCurrent(rows: readonly CurrentRow[], lastLogged: string | null): string | null {
  if (rows.length === 0) return null;
  if (lastLogged === null || !rows.some((r) => r.exercise.id === lastLogged)) {
    const first = rows.find((r) => {
      const p = progressOf(r.exercise);
      return p.remaining > 0 || p.open;
    });
    return (first ?? rows[0]!).exercise.id;
  }
  return advanceAfterLog({ rows, loggedId: lastLogged, wasExtra: false });
}
