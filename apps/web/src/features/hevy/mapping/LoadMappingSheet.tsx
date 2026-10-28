import { normalizeExportAs, parseMappingCsv, type HevyMapping, type HevyTemplate } from "@sin/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "../../../api";
import { reportError } from "../../../observability/reportError";
import { Button } from "../../../ui/Button";
import { Sheet } from "../../../ui/Sheet";
import { useCatalog } from "../../catalog/useCatalog";
import { HevyError } from "../client/hevyErrors";
import { listAll } from "../client/listAll";
import { HEVY_KEYS } from "../keys";
import {
  CANCEL_LOAD,
  CHECKING_FILE,
  CHOOSE_FILE,
  COUNT_CALORIES,
  CSV_ERROR_COPY,
  FILE_COLUMNS,
  FILE_FORMAT_LINE,
  FILE_TOO_BIG,
  HEVY_COPY,
  IGNORE_ASSIST,
  LEFT_OUT_COPY,
  LOAD_SHEET_TITLE,
  MAPPING_OFFLINE,
  MAPPING_RATE_LIMITED,
  MAPPING_REJECTED,
  MAPPING_SAVE_FAILED,
  NO_KEY_FOR_FILE,
  SECTIONS_HEADING,
  SHOW_LIST,
  WHATS_IN_FILE,
  leaveOutNote,
  leftOutHeading,
  lineLabel,
  loadButton,
  loaded,
  needsRuleLine,
  placeholderMissing,
  readingTemplates,
  typeMismatch,
  willBePaired,
  willBeRemovedLine,
} from "../messages";
import { useHevyClient } from "../useHevyClient";
import { applyRule, resolveLines, willBeRemoved, type LeftOut, type Resolved } from "./resolveLines";
import { classifyMappingError, useMappingMutations } from "./useMappingMutations";
import styles from "./LoadMappingSheet.module.css";

type Step =
  | { kind: "choose"; errors: string[] }
  | { kind: "reading"; page: number; pageCount: number }
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
  const queryClient = useQueryClient();
  const { put } = useMappingMutations();
  const [step, setStep] = useState<Step>({ kind: "choose", errors: [] });
  const abort = useRef<AbortController | null>(null);
  const noteId = useId();

  const reset = () => setStep({ kind: "choose", errors: [] });
  const close = () => {
    abort.current?.abort();
    reset();
    onClose();
  };

  async function onFile(file: File) {
    // AC18: a huge file is refused on its size, before it is read or parsed.
    if (file.size > 1_048_576) return setStep({ kind: "choose", errors: [FILE_TOO_BIG] });
    const parsed = parseMappingCsv(await file.text());
    if (parsed.errors.length > 0) {
      const big = parsed.errors.some((e) => e.code === "too_many_lines" || e.code === "file_too_large");
      return setStep({ kind: "choose", errors: big ? [FILE_TOO_BIG] : parsed.errors.map((e) => `${lineLabel(e.line)}: ${CSV_ERROR_COPY[e.code]}`) });
    }
    if (client === null) return setStep({ kind: "choose", errors: [NO_KEY_FOR_FILE] });

    let templates = queryClient.getQueryData<HevyTemplate[]>(HEVY_KEYS.templates);
    if (templates === undefined) {
      const controller = new AbortController();
      abort.current = controller;
      setStep({ kind: "reading", page: 1, pageCount: 1 });
      const out = await listAll((page, signal) => client.listTemplates(page, signal), {
        signal: controller.signal,
        // The last page read, so "page 2 of 3" shows while page 3 is on its way.
        onPage: ({ page, pageCount }) => {
          if (!controller.signal.aborted) setStep({ kind: "reading", page, pageCount });
        },
      });
      if (controller.signal.aborted) return;
      if (out.error !== null) {
        if (out.error.kind === "unexpected_reply" || out.error.kind === "server") reportError(out.error, { source: "hevy", op: "templates" });
        return setStep({ kind: "choose", errors: [HEVY_COPY[out.error.kind]] });
      }
      templates = out.pages.flatMap((p) => p.exercise_templates);
      queryClient.setQueryData(HEVY_KEYS.templates, templates);
    }
    setStep({ kind: "checking" });
    setStep({ kind: "preview", resolved: resolveLines(parsed, { templates, catalog: catalog.rows }), error: null });
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
      const path = err instanceof ApiError ? err.errors[0]?.path : undefined;
      const message =
        kind === "offline" ? MAPPING_OFFLINE
        : kind === "rate_limited" ? MAPPING_RATE_LIMITED
        : kind === "invalid" ? (path ? `${MAPPING_REJECTED} (${path})` : MAPPING_REJECTED)
        : MAPPING_SAVE_FAILED;
      if (kind === "other") reportError(err instanceof Error ? err : new HevyError("unexpected_reply"), { source: "hevy", op: "mapping-put" });
      setStep({ kind: "preview", resolved, error: message });
    }
  }

  return (
    <Sheet open={open} title={LOAD_SHEET_TITLE} onClose={close} dismissible={!put.isPending}>
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
          {step.errors.length > 0 ? (
            <ul className={styles.errors} role="alert">
              {step.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {step.kind === "reading" || step.kind === "checking" ? (
        <div className={styles.body}>
          <p role="status">{step.kind === "reading" ? readingTemplates(step.page, step.pageCount) : CHECKING_FILE}</p>
          <Button variant="secondary" onClick={() => (abort.current?.abort(), reset())}>
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
          {step.error !== null ? <p role="alert">{step.error}</p> : null}
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

function leftOutText(l: LeftOut): string {
  const reason = l.reason === "type_mismatch" && l.hevyTypeLabel && l.modalityLabel
    ? `${typeMismatch(l.hevyWritten, l.sinWritten)} (${l.hevyTypeLabel} · ${l.modalityLabel})`
    : LEFT_OUT_COPY[l.reason];
  return [lineLabel(l.line), l.hevyWritten, l.sinWritten, reason].filter((part) => part !== "").join(" · ");
}

/** AC21: what the file will do, in the spec's order. */
function Preview({ resolved, current, onApplyRule }: { resolved: Resolved; current: HevyMapping; onApplyRule: (templateId: string) => void }) {
  const removed = willBeRemoved(current, resolved.pairs);
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
          <p>{needsRuleLine(n.pair.hevyTitle, lineLabel(n.line))}</p>
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

      <h3 className={styles.heading}>{SECTIONS_HEADING}</h3>
      <ul>
        {resolved.sectionRules.map((r) => (
          <li key={r.name}>{`${r.name}: ${r.treatment}`}</li>
        ))}
        {resolved.notices.flatMap((n) => (n.kind === "placeholder_not_found" ? [<li key={n.which}>{placeholderMissing(n.which)}</li>] : []))}
      </ul>

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
