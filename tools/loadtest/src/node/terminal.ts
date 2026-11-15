/**
 * Spec 16, minor 591 — the CLI's writes to the terminal. After a hang-up (SIGHUP: the terminal is gone) a write can
 * fail with EIO or EPIPE; the run still has cleanup and its result file to finish, so a failed write is dropped, and
 * after `hangUp()` nothing is written at all. The result file is the run's record then.
 */
export function terminalLog(write: (text: string) => void): { log(line: string): void; hangUp(): void } {
  let gone = false;
  return {
    log(line) {
      if (gone) return;
      try {
        write(`${line}\n`);
      } catch {
        // The terminal went away mid-run; the result file still gets everything.
      }
    },
    hangUp() {
      gone = true;
    },
  };
}

/** The streams `ignoreWriteErrors` has already guarded, so a second call adds nothing. */
const guarded = new WeakSet<object>();

/**
 * Minor 591 (code review): a Node stream reports a failed write (EIO on a closed terminal, EPIPE on a dead pipe) as an
 * `error` event, not a throw, and an unhandled one crashes the CLI before cleanup. The CLI calls this once at start for
 * stdout and stderr; the result file is the run's record.
 */
export function ignoreWriteErrors(streams: readonly { on(event: "error", listener: () => void): unknown }[]): void {
  for (const stream of streams) {
    if (guarded.has(stream)) continue;
    guarded.add(stream);
    stream.on("error", () => {});
  }
}
