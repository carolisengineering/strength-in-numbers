import { useEffect, useRef, useState, type FormEvent } from "react";
import { RESULT_REPS_MAX, RESULT_ROUNDS_MAX, TIMER_ROUNDS_MAX, formatClock, sectionScore } from "@sin/core";
import { Button } from "../../../ui/Button";
import { InlineNotice } from "../../../ui/InlineNotice";
import { Sheet } from "../../../ui/Sheet";
import { VisuallyHidden } from "../../../ui/VisuallyHidden";
import { ClockField } from "../../sectionTimer/ClockField";
import { TimerLine } from "../../sectionTimer/TimerLine";
import { CLOCK_HINT } from "../../sectionTimer/timerCopy";
import { NumberStepper } from "../NumberStepper";
import { RESULT_COPY } from "./resultCopy";
import {
  addRoundRow,
  clearResultFields,
  draftFromSection,
  firstEmptyRow,
  liveTotal,
  validateDraft,
  withMode,
  type DraftErrors,
  type ResultDraft,
  type TimedSection,
} from "./resultDraft";
import styles from "./ResultSheet.module.css";

export interface ResultSheetProps {
  open: boolean;
  /** The projected section; the draft is seeded from it once per mount (the owner keys the sheet per opening). */
  section: TimedSection;
  busy: boolean;
  /** A save failure to show in the open sheet (the edit screen); `null` otherwise. */
  formError: string | null;
  onCancel(): void;
  onSave(draft: ResultDraft): void;
}

/** Spec 17.10 AC13: the one hint the round fields share; Set Timer's rows and the round-ends group never both render. */
const CLOCK_HINT_ID = "result-clock-hint";

const step = (text: string, by: 1 | -1, max: number): string => {
  const n = text === "" ? 0 : Number(text);
  if (text === "" && by === -1) return text;
  return String(Math.min(max, Math.max(0, n + by)));
};

/**
 * Spec 10.7 AC27–AC33 — Log result: the section's round times and result, by format, in local state seeded from the
 * projection and never stored. No autofocus; the first empty round carries `Next` and is scrolled into view. Save
 * checks every field through `@sin/core` and focuses the first error; otherwise it hands the draft to the owner.
 */
export function ResultSheet({ open, section, busy, formError, onCancel, onSave }: ResultSheetProps) {
  const [draft, setDraft] = useState<ResultDraft>(() => draftFromSection(section));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [focusTick, setFocusTick] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const { timer } = section;
  const next = firstEmptyRow(draft);
  const total = liveTotal(timer, draft);

  // AC27: bring the Next row into view on open (once).
  useEffect(() => {
    if (next === null) return;
    document.getElementById(`result-round-${next}`)?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open only
  }, []);
  // AC31: after a Save with errors, the first invalid control in DOM order takes focus.
  useEffect(() => {
    if (focusTick === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateDraft(timer, draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFocusTick((t) => t + 1);
      return;
    }
    onSave(draft);
  }

  const setRow = (round: number, digits: string) => setDraft((d) => ({ ...d, rows: d.rows.map((r) => (r.round === round ? { ...r, digits } : r)) }));
  const roundRow = (round: number, digits: string) => (
    <div key={round} className={styles.round} data-round={round}>
      <ClockField id={`result-round-${round}`} label={RESULT_COPY.roundLabel(round)} hint={null} describedBy={CLOCK_HINT_ID} digits={digits} error={errors[`row:${round}`]} onChange={(d) => setRow(round, d)} />
      {round === next ? <span className={styles.next}>{RESULT_COPY.next}</span> : null}
    </div>
  );
  const steppers = (
    <div className={styles.steppers}>
      <NumberStepper
        id="result-rounds"
        label={RESULT_COPY.rounds}
        value={draft.rounds}
        inputMode="numeric"
        error={errors["rounds"]}
        decreaseText={RESULT_COPY.stepDown}
        increaseText={RESULT_COPY.stepUp}
        decreaseLabel={RESULT_COPY.decreaseRounds}
        increaseLabel={RESULT_COPY.increaseRounds}
        canDecrease={draft.rounds !== "" && Number(draft.rounds) > 0}
        canIncrease={draft.rounds === "" || Number(draft.rounds) < RESULT_ROUNDS_MAX}
        onChange={(v) => setDraft((d) => ({ ...d, rounds: v.replace(/\D/g, "") }))}
        onDecrease={() => setDraft((d) => ({ ...d, rounds: step(d.rounds, -1, RESULT_ROUNDS_MAX) }))}
        onIncrease={() => setDraft((d) => ({ ...d, rounds: step(d.rounds, 1, RESULT_ROUNDS_MAX) }))}
      />
      <NumberStepper
        id="result-reps"
        label={RESULT_COPY.reps}
        value={draft.reps}
        inputMode="numeric"
        error={errors["reps"]}
        decreaseText={RESULT_COPY.stepDown}
        increaseText={RESULT_COPY.stepUp}
        decreaseLabel={RESULT_COPY.decreaseReps}
        increaseLabel={RESULT_COPY.increaseReps}
        canDecrease={draft.reps !== "" && Number(draft.reps) > 0}
        canIncrease={draft.reps === "" || Number(draft.reps) < RESULT_REPS_MAX}
        onChange={(v) => setDraft((d) => ({ ...d, reps: v.replace(/\D/g, "") }))}
        onDecrease={() => setDraft((d) => ({ ...d, reps: step(d.reps, -1, RESULT_REPS_MAX) }))}
        onIncrease={() => setDraft((d) => ({ ...d, reps: step(d.reps, 1, RESULT_REPS_MAX) }))}
      />
    </div>
  );
  const highest = draft.rows.reduce((m, r) => Math.max(m, r.round), 0);
  const roundEnds = (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{RESULT_COPY.roundEnds}</legend>
      <p className={styles.hint} id={CLOCK_HINT_ID}>{`${RESULT_COPY.roundEndsHint} ${CLOCK_HINT}`}</p>
      {draft.rows.map((r) => roundRow(r.round, r.digits))}
      {highest < TIMER_ROUNDS_MAX ? (
        <Button variant="secondary" className={styles.addRound} onClick={() => setDraft(addRoundRow)}>
          {RESULT_COPY.addRoundTime}
        </Button>
      ) : null}
    </fieldset>
  );

  return (
    <Sheet noActionRow open={open} title={RESULT_COPY.title} onClose={onCancel} dismissible={!busy}>
      <form ref={formRef} className={styles.form} noValidate onSubmit={submit}>
        <div className={styles.header}>
          <p className={styles.name}>{section.name}</p>
          <TimerLine timer={timer} score={sectionScore(section)} />
        </div>

        {timer.format === "set_timer" ? (
          <>
            <p className={styles.hint} id={CLOCK_HINT_ID}>
              {CLOCK_HINT}
            </p>
            {draft.rows.map((r) => roundRow(r.round, r.digits))}
            {total !== null ? <p className={styles.total}>{RESULT_COPY.total(formatClock(total))}</p> : null}
          </>
        ) : null}

        {timer.format === "amrap" ? (
          <>
            {steppers}
            {roundEnds}
          </>
        ) : null}

        {timer.format === "time_cap" ? (
          <>
            {timer.capSeconds !== null ? (
              <fieldset className={styles.group}>
                <legend>
                  <VisuallyHidden>{RESULT_COPY.outcome}</VisuallyHidden>
                </legend>
                <div className={styles.radios}>
                  {(["finished", "capped"] as const).map((mode) => (
                    <label key={mode} className={styles.radio}>
                      <input type="radio" name="result-mode" checked={draft.mode === mode} onChange={() => setDraft((d) => withMode(d, mode))} />
                      {mode === "finished" ? RESULT_COPY.finished : RESULT_COPY.hitCap}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {draft.mode === "finished" ? (
              <ClockField id="result-finish" label={RESULT_COPY.finishTime} digits={draft.finishDigits} error={errors["finish"]} onChange={(d) => setDraft((x) => ({ ...x, finishDigits: d }))} />
            ) : (
              steppers
            )}
            {roundEnds}
          </>
        ) : null}

        {section.result !== null && timer.format !== "set_timer" ? (
          <Button variant="secondary" className={styles.clear} onClick={() => setDraft(clearResultFields)}>
            {RESULT_COPY.clearResult}
          </Button>
        ) : null}

        {formError ? <InlineNotice tone="error">{formError}</InlineNotice> : null}
        <div className={styles.actions}>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {RESULT_COPY.cancel}
          </Button>
          <Button type="submit" busy={busy}>
            {RESULT_COPY.save}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
