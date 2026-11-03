import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkoutDetail, WorkoutSection } from "@sin/core";
import { RESULT_COPY } from "./resultCopy";
import { diffDraft, type ResultDraft, type ResultWrite, type TimedSection } from "./resultDraft";

/** How a screen sends a Save's writes (live: the queued client; edit: REST, one by one). */
export interface ResultWriter {
  save(section: WorkoutSection, writes: readonly ResultWrite[]): Promise<{ ok: true } | { ok: false; failedAt: number; error: unknown }>;
}

export type ResultFailure = { failedAt: number; error: unknown };

export interface ResultActionDeps {
  /** The workout as shown (projected on the live screen). */
  workout: WorkoutDetail;
  writer: ResultWriter;
  /** The screen's one polite status line. */
  announce(text: string): void;
  /**
   * What a failed Save says in the open sheet, or `null` to close it (and the caller announces or re-reads). Absent:
   * the partial-failure line.
   */
  failureText?(failure: ResultFailure): string | null;
}

export interface ResultActions {
  sheet: { section: TimedSection; openCount: number } | null;
  open(sectionId: string): void;
  close(): void;
  save(draft: ResultDraft): Promise<void>;
  busy: boolean;
  formError: string | null;
  logResultRefFor(sectionId: string): (node: HTMLButtonElement | null) => void;
}

/**
 * Spec 10.7 AC27, AC31, AC42 — Log result's behavior, shared by the live and the edit screen: one opening at a time
 * (keyed by an open counter so the draft reseeds), a close when the section or its timer disappears, the Save diff
 * through the screen's writer, and focus back to the section's Log result button after every close.
 */
export function useResultActions({ workout, writer, announce, failureText }: ResultActionDeps): ResultActions {
  const [view, setView] = useState<{ sectionId: string; openCount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const counter = useRef(0);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const callbacks = useRef(new Map<string, (node: HTMLButtonElement | null) => void>());
  const focusAfter = useRef<string | null>(null);

  const section = view === null ? undefined : workout.sections.find((s) => s.id === view.sectionId);

  const close = useCallback(() => {
    setView((v) => {
      if (v !== null) focusAfter.current = v.sectionId;
      return null;
    });
    setFormError(null);
  }, []);

  // AC27: another device removed the section, or its timer, while the sheet was open.
  useEffect(() => {
    if (view === null) return;
    if (section === undefined) {
      close();
      announce(RESULT_COPY.sectionGone);
    } else if (section.timer === null) {
      close();
      announce(RESULT_COPY.timerGone);
    }
  }, [view, section, close, announce]);

  // Focus returns to the section's Log result button once the sheet has closed.
  useEffect(() => {
    const id = focusAfter.current;
    if (id === null || view !== null) return;
    const node = buttons.current.get(id);
    if (!node) return;
    focusAfter.current = null;
    node.focus();
  });

  const open = useCallback((sectionId: string) => {
    counter.current += 1;
    setFormError(null);
    setView({ sectionId, openCount: counter.current });
  }, []);

  const save = useCallback(
    async (draft: ResultDraft) => {
      if (section === undefined || section.timer === null || busy) return;
      const timed = section as TimedSection;
      const writes = diffDraft(timed, draft);
      if (writes.length === 0) {
        close(); // AC31: nothing changed — close, send nothing, say nothing
        return;
      }
      setBusy(true);
      setFormError(null);
      try {
        const result = await writer.save(timed, writes);
        if (result.ok) {
          close();
          announce(RESULT_COPY.saved);
          return;
        }
        const text = failureText ? failureText(result) : RESULT_COPY.partial;
        if (text === null) close();
        else setFormError(text);
      } finally {
        setBusy(false);
      }
    },
    [section, busy, writer, close, announce, failureText],
  );

  const logResultRefFor = useCallback((sectionId: string) => {
    let callback = callbacks.current.get(sectionId);
    if (!callback) {
      callback = (node) => {
        if (node) buttons.current.set(sectionId, node);
        else buttons.current.delete(sectionId);
      };
      callbacks.current.set(sectionId, callback);
    }
    return callback;
  }, []);

  return {
    sheet: view !== null && section !== undefined && section.timer !== null ? { section: section as TimedSection, openCount: view.openCount } : null,
    open,
    close,
    save,
    busy,
    formError,
    logResultRefFor,
  };
}
