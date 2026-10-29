import { normalizeExportAs, parseMappingCsv, sectionKey, type HevyMapping, type HevyTemplate } from "@sin/core";
import { isCancelledError, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";

import { reportError } from "../../../observability/reportError";
import { Button } from "../../../ui/Button";
import { Sheet } from "../../../ui/Sheet";
import { useCatalog } from "../../catalog/useCatalog";
import { HevyError } from "../client/hevyErrors";
import { HEVY_KEYS } from "../keys";
import { TREATMENT_LABELS } from "../labels";
import {
  CANCEL_LOAD,
  CATALOG_NOT_READY,
  CHECKING_FILE,
  CHOOSE_FILE,
  COUNT_CALORIES,
  CSV_ERROR_COPY,
  FILE_COLUMNS,
  FILE_FORMAT_LINE,
  FILE_READ_FAILED,
  FILE_TOO_BIG,
  HEVY_COPY,
  IGNORE_ASSIST,
  LEFT_OUT_COPY,
  LOAD_SHEET_TITLE,
  NOTICES_LABEL,
  NO_KEY_FOR_FILE,
  SECTIONS_HEADING,
  SHOW_LIST,
  WHATS_IN_FILE,
  exportAsTwiceNotice,
  idTitleNotice,
  leaveOutNote,
  leftOutHeading,
  lineLabel,
  loadButton,
  loaded,
  markerLine,
  needsRuleLine,
  placeholderMissing,
  readingTemplates,
  sectionRulesRemovedLine,
  SECTION_RULES_DROPPED_LABEL,
  typeMismatch,
  willBePaired,
  willBeRemovedLine,
  willChangeLine,
} from "../messages";
import { useHevyClient } from "../useHevyClient";
import { applyRule, resolveLines, sectionRulesRemoved, willBeRemoved, willChange, type LeftOut, type ResolveNotice, type Resolved } from "./resolveLines";
import { useTemplatesProgress } from "./templatesProgress";
import { hevyTemplatesQuery } from "./useHevyTemplates";
import { classifyMappingError, mappingErrorMessage, useMappingMutations } from "./useMappingMutations";
import styles from "./LoadMappingSheet.module.css";

const FIRST_PAGE = { page: 1, pageCount: 1 };

type Step =
  | { kind: "choose"; errors: string[] }
  | { kind: "reading" }
  | { kind: "checking" }
  | { kind: "preview"; resolved: Resolved; error: string | null };

export interface LoadMappingSheetProps {
  open: boolean;
  /** The stored mapping, so the preview can say what a replace removes (AC21). */
  current: HevyMapping;
  onClose: () => void;
  /** After the replace: the card's status line text. */
  onLoaded: (announcement: string) => void;
}

/**
 * Spec 20.0 AC18–AC22, §5.2: load a mapping file. Choose → read Hevy's exercise list (with the key) → check the
 * file → preview what is paired, left out and removed → one `PUT`. The file text and the preview live only in this
 * component's state; nothing is stored on the device.
 */
export function LoadMappingSheet({ open, current, onClose, onLoaded }: LoadMappingSheetProps) {
  const client = useHevyClient();
  const { state: catalog } = useCatalog();
  // The list as it is when the file resolves, not when it was picked: the Hevy read can take a while.
  const catalogNow = useRef(catalog);
  catalogNow.current = catalog;
  const queryClient = useQueryClient();
  const { put } = useMappingMutations();
  const [step, setStep] = useState<Step>({ kind: "choose", errors: [] });
  // Minor 197: the shared read's own progress, so joining a read already running shows its real page. The last page
  // seen is kept, so the line never drops back to "page 1 of 1" when the read ends before the step moves on.
  const live = useTemplatesProgress();
  const [lastPage, setLastPage] = useState(FIRST_PAGE);
  if (live !== null && (live.page !== lastPage.page || live.pageCount !== lastPage.pageCount)) setLastPage(live);
  const progress = live ?? lastPage;
  const noteId = useId();
  // Each file read has a number; Cancel, close and unmount move it on, so a late answer is ignored.
  const readId = useRef(0);
  const reading = useRef(false);
  const stopRead = () => {
    readId.current += 1;
    if (reading.current) void queryClient.cancelQueries({ queryKey: HEVY_KEYS.templates });
    reading.current = false;
  };
  // Minor 184: leaving the screen mid-read stops the paced Hevy reads.
  useEffect(() => () => stopRead(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => setStep({ kind: "choose", errors: [] });
  const close = () => {
    stopRead();
    reset();
    onClose();
  };

  async function onFile(file: File) {
    // AC18: a huge file is refused on its size, before it is read or parsed.
    if (file.size > 1_048_576) return setStep({ kind: "choose", errors: [FILE_TOO_BIG] });
    const id = ++readId.current;
    let text: string;
    try {
      text = await file.text();
    } catch {
      // Minor 201: a read that fails after Cancel or close says nothing, as every other await here.
      if (id !== readId.current) return;
      return setStep({ kind: "choose", errors: [FILE_READ_FAILED] });
    }
    if (id !== readId.current) return;
    const parsed = parseMappingCsv(text);
    if (parsed.errors.length > 0) {
      const big = parsed.errors.some((e) => e.code === "too_many_lines" || e.code === "file_too_large");
      return setStep({ kind: "choose", errors: big ? [FILE_TOO_BIG] : parsed.errors.map((e) => `${lineLabel(e.line)}: ${CSV_ERROR_COPY[e.code]}`) });
    }
    if (client === null) return setStep({ kind: "choose", errors: [NO_KEY_FOR_FILE] });
    // Never against a list that has not synced: every line would be 'not found' and the replace would wipe the mapping.
    if (catalogNow.current.syncToken === null) return setStep({ kind: "choose", errors: [CATALOG_NOT_READY] });

    setStep({ kind: "reading" });
    setLastPage(FIRST_PAGE);
    let templates: HevyTemplate[];
    reading.current = true;
    try {
      // Minor 191: the hook's read, so a cached or in-flight list is reused. Its progress is `useTemplatesProgress`.
      templates = await queryClient.fetchQuery(hevyTemplatesQuery(client));
    } catch (error) {
      if (id !== readId.current) return;
      reading.current = false;
      // A cancel from elsewhere (a key change removes the cached list) goes back to Choose, never stuck on Reading.
      if (isCancelledError(error)) return reset();
      const failure = error instanceof HevyError ? error : new HevyError("unexpected_reply");
      if (failure.kind === "unexpected_reply" || failure.kind === "server") reportError(failure, { source: "hevy", op: "templates" });
      return setStep({ kind: "choose", errors: [HEVY_COPY[failure.kind]] });
    }
    reading.current = false;
    if (id !== readId.current) return;
    setStep({ kind: "checking" });
    if (catalogNow.current.syncToken === null) return setStep({ kind: "choose", errors: [CATALOG_NOT_READY] });
    setStep({ kind: "preview", resolved: resolveLines(parsed, { templates, catalog: catalogNow.current.rows }), error: null });
  }

  async function save(resolved: Resolved) {
    const pairs = normalizeExportAs(resolved.pairs);
    setStep({ kind: "preview", resolved, error: null });
    try {
      await put.mutateAsync({ pairs, sectionRules: resolved.sectionRules });
      reset();
      onLoaded(loaded(pairs.length));
    } catch (err) {
      const kind = classifyMappingError(err);
      const message = mappingErrorMessage(err);
      if (kind === "other") reportError(err instanceof Error ? err : new HevyError("unexpected_reply"), { source: "hevy", op: "mapping-put" });
      setStep({ kind: "preview", resolved, error: message });
    }
  }

  return (
    <Sheet open={open} title={LOAD_SHEET_TITLE} onClose={close} dismissible={!put.isPending}>
      {/* Minor 185: both regions are there from first paint, empty, so their text is announced when it arrives. */}
      <p className={styles.progress} role="status" data-testid="hevy-load-progress">
        {step.kind === "reading" ? readingTemplates(progress.page, progress.pageCount) : step.kind === "checking" ? CHECKING_FILE : ""}
      </p>
      <div role="alert" data-testid="hevy-load-errors">
        {errorsOf(step).length > 0 ? (
          <ul className={styles.errors}>
            {errorsOf(step).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {step.kind === "choose" ? (
        <div className={styles.body}>
          <p className={styles.muted}>{FILE_FORMAT_LINE}</p>
          <details>
            <summary>{WHATS_IN_FILE}</summary>
            <p className={styles.muted}>{FILE_COLUMNS}</p>
          </details>
          <label className={styles.file}>
            <span>{CHOOSE_FILE}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onFile(file);
              }}
            />
          </label>
        </div>
      ) : null}

      {step.kind === "reading" || step.kind === "checking" ? (
        <div className={styles.body}>
          <Button variant="secondary" onClick={() => (stopRead(), reset())}>
            {CANCEL_LOAD}
          </Button>
        </div>
      ) : null}

      {step.kind === "preview" ? (
        <div className={styles.body}>
          <Preview
            resolved={step.resolved}
            current={current}
            onApplyRule={(templateId) => setStep({ ...step, resolved: applyRule(step.resolved, templateId) })}
          />
          <div className={styles.actions}>
            <Button
              busy={put.isPending}
              disabled={put.isPending || step.resolved.needsRule.length > 0}
              aria-describedby={step.resolved.leftOut.length > 0 ? noteId : undefined}
              onClick={() => void save(step.resolved)}
            >
              {loadButton(step.resolved.pairs.length)}
            </Button>
            <Button variant="secondary" disabled={put.isPending} onClick={close}>
              {CANCEL_LOAD}
            </Button>
          </div>
          {step.resolved.leftOut.length > 0 ? (
            <p className={styles.muted} id={noteId}>
              {leaveOutNote(step.resolved.leftOut.length)}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

function errorsOf(step: Step): string[] {
  if (step.kind === "choose") return step.errors;
  if (step.kind === "preview" && step.error !== null) return [step.error];
  return [];
}

function leftOutText(l: LeftOut): string {
  const reason = l.reason === "type_mismatch" && l.hevyTypeLabel && l.modalityLabel
    ? `${typeMismatch(l.hevyWritten, l.sinWritten)} (${l.hevyTypeLabel} · ${l.modalityLabel})`
    : LEFT_OUT_COPY[l.reason];
  return [lineLabel(l.line), l.hevyWritten, l.sinWritten, reason].filter((part) => part !== "").join(" · ");
}

function noticeText(n: Exclude<ResolveNotice, { kind: "placeholder_not_found" }>): string {
  return n.kind === "id_title_disagree" ? idTitleNotice(n.line) : exportAsTwiceNotice(n.line);
}

/** AC21: what the file will do, in the spec's order. */
function Preview({ resolved, current, onApplyRule }: { resolved: Resolved; current: HevyMapping; onApplyRule: (templateId: string) => void }) {
  const removed = willBeRemoved(current, resolved.pairs);
  const changed = willChange(current, resolved.pairs);
  const rulesDropped = sectionRulesRemoved(current, resolved.sectionRules);
  const markers = resolved.pairs.filter((p) => p.role === "warmup_placeholder" || p.role === "workout_placeholder");
  const lineNotices = resolved.notices.flatMap((n) => (n.kind === "placeholder_not_found" ? [] : [n]));
  // AC32: once the file is resolved, focus moves to the preview's first heading (once, not on each rule tap).
  const firstHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    firstHeading.current?.focus();
  }, []);
  return (
    <section className={styles.preview} aria-label="Preview">
      <h3 className={styles.heading} tabIndex={-1} ref={firstHeading}>
        {willBePaired(resolved.pairs.length)}
      </h3>
      {resolved.pairs.length > 0 ? (
        <details>
          <summary>{SHOW_LIST}</summary>
          <ul>
            {resolved.pairs.map((p) => (
              <li key={p.hevyTemplateId}>{p.hevyTitle}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {resolved.needsRule.map((n) => (
        <div key={n.templateId} className={styles.fix}>
          <p>{needsRuleLine(n.pair.hevyTitle, n.sinName)}</p>
          <Button variant="secondary" onClick={() => onApplyRule(n.templateId)}>
            {n.rule === "calories_as_reps" ? COUNT_CALORIES : IGNORE_ASSIST}
          </Button>
        </div>
      ))}

      {resolved.leftOut.length > 0 ? (
        <>
          <h3 className={styles.heading}>{leftOutHeading(resolved.leftOut.length)}</h3>
          <ul aria-label="Left out">
            {resolved.leftOut.map((l) => (
              <li key={`${l.line}-${l.reason}`}>{leftOutText(l)}</li>
            ))}
          </ul>
        </>
      ) : null}

      {lineNotices.length > 0 ? (
        <ul aria-label={NOTICES_LABEL}>
          {lineNotices.map((n) => (
            <li key={`${n.kind}-${n.line}`}>{noticeText(n)}</li>
          ))}
        </ul>
      ) : null}

      <h3 className={styles.heading}>{SECTIONS_HEADING}</h3>
      <ul>
        {markers.map((p) => (
          <li key={p.hevyTemplateId}>{markerLine(p.role === "warmup_placeholder" ? "warmup" : "workout", p.hevyTitle)}</li>
        ))}
        {resolved.sectionRules.map((r) => (
          <li key={sectionKey(r.name)}>{`${r.name}: ${TREATMENT_LABELS[r.treatment]}`}</li>
        ))}
        {resolved.notices.flatMap((n) => (n.kind === "placeholder_not_found" ? [<li key={n.which}>{placeholderMissing(n.which)}</li>] : []))}
      </ul>

      {rulesDropped.length > 0 ? (
        <>
          <h3 className={styles.heading}>{sectionRulesRemovedLine(rulesDropped.length)}</h3>
          <ul aria-label={SECTION_RULES_DROPPED_LABEL}>
            {rulesDropped.map((r) => (
              <li key={sectionKey(r.name)}>{`${r.name}: ${TREATMENT_LABELS[r.treatment]}`}</li>
            ))}
          </ul>
        </>
      ) : null}

      {changed.length > 0 ? (
        <>
          <h3 className={styles.heading}>{willChangeLine(changed.length)}</h3>
          <ul aria-label="Will change">
            {changed.map((p) => (
              <li key={p.hevyTemplateId}>{p.hevyTitle}</li>
            ))}
          </ul>
        </>
      ) : null}

      {removed.length > 0 ? (
        <>
          <h3 className={styles.heading}>{willBeRemovedLine(removed.length)}</h3>
          <details>
            <summary>{SHOW_LIST}</summary>
            <ul>
              {removed.map((p) => (
                <li key={p.hevyTemplateId}>{p.hevyTitle}</li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </section>
  );
}
