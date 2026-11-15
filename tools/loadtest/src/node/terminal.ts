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
