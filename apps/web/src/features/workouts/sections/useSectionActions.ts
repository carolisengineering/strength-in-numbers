import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ROUTINE_SECTIONS_MAX, type WorkoutDetail, type WorkoutExerciseDetail } from "@sin/core";
import { reportUnexpected } from "../reportUnexpected";
import { SECTION_COPY, movedOut, movedTo, sectionAdded } from "./sectionCopy";
import { sectionPickerId } from "./SectionPicker";
import { checkSectionFields, sectionBody, type SectionValues } from "./sectionFields";
import type { SectionMutations } from "./sectionMutations";
import type { SectionSheetErrors } from "./SectionSheet";
import { resolveSectionFailure, type SectionOp } from "./resolveSectionFailure";

export interface SectionBanner {
  tone: "warning" | "error";
  text: string;
  requestId?: string | null;
  retry?: () => void;
}

/** What a screen injects (Spec 10.6 §6.3): its mutation set, lock, banner, status line, refetch and gone path. */
export interface SectionActionDeps {
  workout: WorkoutDetail;
  mutations: SectionMutations;
  /** The screen's structure lock: a write begun while another structure write is in flight is ignored (AC12). */
  structureLock: { current: boolean };
  setBanner(banner: SectionBanner | null): void;
  /** The screen's one polite status line. */
  announce(text: string): void;
  /** Re-read the workout; resolves to the fresh detail (absent or another workout = gone). */
  refetch(): Promise<WorkoutDetail | null | undefined>;
  onGone(): void;
  offlineText: string;
  /**
   * After a move: the screen reveals the remounted card and focuses its heading (§6.4) — once the card shows under
   * `sectionId`, never on a later unrelated change if the re-read failed (#157).
   */
  onMoved(exerciseId: string, sectionId: string | null): void;
}

export interface SheetView {
  readonly session: number;
  readonly mode: "add" | "edit";
  readonly sectionId: string | null;
}

export interface SectionActions {
  /** The open sheet, or null. */
  sheet: SheetView | null;
  /** The sheet as last opened, kept after it closes so the dialog can close in place. */
  sheetView: SheetView | null;
  errors: SectionSheetErrors;
  busy: boolean;
  openAdd(): void;
  openEdit(sectionId: string): void;
  closeSheet(): void;
  submitSheet(values: SectionValues): Promise<void>;
  removeOpen: boolean;
  requestRemove(): void;
  cancelRemove(): void;
  confirmRemove(): Promise<void>;
  setExerciseSection(exercise: WorkoutExerciseDetail, sectionId: string | null): Promise<void>;
  addSectionRef: RefObject<HTMLButtonElement | null>;
  editRefFor(sectionId: string): (node: HTMLButtonElement | null) => void;
  removeRef(node: HTMLButtonElement | null): void;
}

type FocusTarget =
  | { kind: "add" }
  /** `wait`: the Edit button is about to render (a new section), so do not fall back to Add section meanwhile. */
  | { kind: "edit"; sectionId: string; wait?: boolean }
  | { kind: "remove" }
  /** After a failed move: the card's Section select (the browser moved focus off it while it was disabled). */
  | { kind: "select"; exerciseId: string }
  | null;

const NO_ERRORS: SectionSheetErrors = { name: null, notes: null, form: null };

/**
 * Spec 10.6 §6.3 — the section controls' behavior, shared by the live and the edit screen. It owns the
 * sheet and confirm state, the double-tap guards, the failure table (`resolveSectionFailure`), the
 * announcements and the focus rule of AC6–AC8; everything screen-specific is injected.
 */
export function useSectionActions(deps: SectionActionDeps): SectionActions {
  const { workout, mutations, structureLock, setBanner, announce, refetch, onGone, offlineText, onMoved } = deps;
  const [view, setView] = useState<(SheetView & { open: boolean }) | null>(null);
  const [errors, setErrors] = useState<SectionSheetErrors>(NO_ERRORS);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const sessionRef = useRef(0);
  // The workout as last rendered: a Try again tapped later reads it, not the render that failed.
  const latest = useRef(workout);
  useLayoutEffect(() => {
    latest.current = workout;
  });
  // The last sheet opening that was closed: a submit from that opening (a tap landing before the close commits) is ignored.
  const closedSessionRef = useRef(0);

  const addSectionRef = useRef<HTMLButtonElement | null>(null);
  const editNodes = useRef(new Map<string, HTMLButtonElement>());
  const editCallbacks = useRef(new Map<string, (node: HTMLButtonElement | null) => void>());
  const removeNode = useRef<HTMLButtonElement | null>(null);

  // jsdom's dialog shim does not restore focus, and after a remove the opener is gone: focus is explicit,
  // after the commit that closed the dialogs. A target that is still disabled (the write's busy state) waits.
  const pendingFocus = useRef<FocusTarget>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const node: HTMLButtonElement | HTMLSelectElement | null =
      target.kind === "add"
        ? addSectionRef.current
        : target.kind === "remove"
          ? removeNode.current
          : target.kind === "select"
            ? (document.getElementById(sectionPickerId(target.exerciseId)) as HTMLSelectElement | null)
            : (editNodes.current.get(target.sectionId) ?? (target.wait ? null : addSectionRef.current));
    if (!node || node.disabled) return;
    pendingFocus.current = null;
    node.focus();
  });

  const editRefFor = useCallback((sectionId: string) => {
    let callback = editCallbacks.current.get(sectionId);
    if (!callback) {
      callback = (node) => {
        if (node) editNodes.current.set(sectionId, node);
        else editNodes.current.delete(sectionId);
      };
      editCallbacks.current.set(sectionId, callback);
    }
    return callback;
  }, []);
  const removeRef = useCallback((node: HTMLButtonElement | null) => {
    removeNode.current = node;
  }, []);

  const sheet = view !== null && view.open ? { session: view.session, mode: view.mode, sectionId: view.sectionId } : null;

  function open(mode: "add" | "edit", sectionId: string | null) {
    sessionRef.current += 1;
    setErrors(NO_ERRORS);
    setRemoveOpen(false);
    setView({ session: sessionRef.current, mode, sectionId, open: true });
  }

  function closeAll(focus: FocusTarget) {
    closedSessionRef.current = sessionRef.current;
    setView((v) => (v === null ? v : { ...v, open: false }));
    setRemoveOpen(false);
    setErrors(NO_ERRORS);
    pendingFocus.current = focus;
  }

  /** Add section, unless it is disabled at the cap (a waiting target would steal focus once the cap lifts). */
  const addTarget = (): FocusTarget => (latest.current.sections.length >= ROUTINE_SECTIONS_MAX ? null : { kind: "add" });
  const openerOf = (s: SheetView | null): FocusTarget =>
    s?.mode === "edit" && s.sectionId !== null ? { kind: "edit", sectionId: s.sectionId } : addTarget();

  function begin(): boolean {
    if (structureLock.current || submittingRef.current) return false;
    structureLock.current = true;
    submittingRef.current = true;
    pendingFocus.current = null;
    setSubmitting(true);
    setBanner(null);
    return true;
  }
  function end() {
    structureLock.current = false;
    submittingRef.current = false;
    setSubmitting(false);
  }

  /** The AC13 table. `inSheet`: the failure can show in the open sheet; `retry` re-runs the write. */
  async function fail(
    op: SectionOp,
    error: unknown,
    ui: { inSheet: boolean; focus: FocusTarget; retry?: () => void; exerciseId?: string },
  ) {
    const failure = resolveSectionFailure(op, error, { offlineText });
    if (failure.report) reportUnexpected(op, error);
    const formOrBanner = (text: string) => {
      if (ui.inSheet) setErrors({ ...NO_ERRORS, form: text });
      else setBanner({ tone: "error", text });
    };
    switch (failure.type) {
      case "offline":
      case "rate-limited":
        formOrBanner(failure.text);
        return;
      case "limit":
        formOrBanner(failure.text);
        await refetch(); // AC13: the row's count refreshes, so Add section shows the cap
        return;
      case "fields":
        if (ui.inSheet) {
          const unmatched = failure.name === null && failure.notes === null;
          setErrors({ name: failure.name, notes: failure.notes, form: unmatched ? SECTION_COPY.fieldsGeneric : null });
        } else {
          setBanner({ tone: "error", text: SECTION_COPY.fieldsGeneric });
        }
        return;
      case "missing": {
        const fresh = await refetch();
        if (!fresh || fresh.id !== workout.id) {
          closeAll(null);
          onGone();
          return;
        }
        // A move's 404 can also mean the exercise is gone: the refetch already shows that, and the section is not.
        if (ui.exerciseId !== undefined && !fresh.exercises.some((e) => e.id === ui.exerciseId)) return;
        closeAll(addTarget());
        setBanner({ tone: "warning", text: SECTION_COPY.sectionGone });
        return;
      }
      case "workout-gone":
        closeAll(null);
        onGone();
        return;
      case "done":
        // A remove whose section is already gone (a mutation set that lets the 404 through): what was asked is done.
        await refetch();
        closeAll(addTarget());
        announce(SECTION_COPY.removed);
        return;
      case "unconfirmed":
        // AC14: no blind retry of a create — show the lifter whether it exists first.
        await refetch();
        closeAll(addTarget());
        setBanner({ tone: "warning", text: failure.text, requestId: failure.requestId });
        return;
      case "retry":
        if (op === "update-section") {
          setErrors({ ...NO_ERRORS, form: failure.text }); // Save is the retry
          return;
        }
        closeAll(ui.focus);
        setBanner({
          tone: "error",
          text: failure.text,
          requestId: failure.requestId,
          ...(failure.offerRetry && ui.retry ? { retry: ui.retry } : {}),
        });
    }
  }

  async function submitSheet(values: SectionValues) {
    if (sheet === null || sheet.session <= closedSessionRef.current) return;
    const checked = checkSectionFields(values.name, values.notes);
    if (checked.name !== null || checked.notes !== null) {
      setErrors({ ...checked, form: null });
      return;
    }
    const stored = sheet.mode === "edit" ? workout.sections.find((s) => s.id === sheet.sectionId) : undefined;
    if (sheet.mode === "edit" && stored === undefined) {
      closeAll(addTarget());
      setBanner({ tone: "warning", text: SECTION_COPY.sectionGone });
      return;
    }
    const body = sectionBody(sheet.mode, values, stored);
    if (body === null) {
      closeAll(openerOf(sheet)); // nothing changed: no request
      return;
    }
    if (!begin()) return;
    try {
      if (sheet.mode === "add") {
        const created = await mutations.add(body as { name: string; notes?: string });
        // At the cap Add section is disabled and cannot take focus: the new section's Edit does.
        const atCap = workout.sections.length + 1 >= ROUTINE_SECTIONS_MAX;
        closeAll(atCap ? { kind: "edit", sectionId: created.id, wait: true } : { kind: "add" });
        announce(sectionAdded(created.name));
      } else {
        await mutations.update(stored!.id, body);
        closeAll(openerOf(sheet));
        announce(SECTION_COPY.saved);
      }
    } catch (error) {
      await fail(sheet.mode === "add" ? "add-section" : "update-section", error, { inSheet: true, focus: openerOf(sheet) });
    } finally {
      end();
    }
  }

  async function removeSection(sectionId: string) {
    if (!begin()) return;
    const exerciseCount = workout.exercises.filter((e) => e.sectionId === sectionId).length;
    try {
      await mutations.remove(sectionId, exerciseCount);
      closeAll(addTarget());
      announce(SECTION_COPY.removed);
    } catch (error) {
      setRemoveOpen(false);
      await fail("remove-section", error, {
        inSheet: true,
        focus: { kind: "edit", sectionId },
        retry: () => void removeSection(sectionId),
      });
    } finally {
      end();
    }
  }

  async function setExerciseSection(exercise: WorkoutExerciseDetail, sectionId: string | null) {
    if (sectionId === exercise.sectionId) return;
    await moveExercise(exercise.id, sectionId);
  }

  /** A move, read against the workout as last rendered (so a later Try again sees where the exercise is now). */
  async function moveExercise(exerciseId: string, sectionId: string | null) {
    const exercise = latest.current.exercises.find((e) => e.id === exerciseId);
    if (exercise === undefined || sectionId === exercise.sectionId) return;
    if (!begin()) return;
    try {
      await mutations.setSection(exercise.id, sectionId);
      const section = sectionId === null ? undefined : latest.current.sections.find((s) => s.id === sectionId);
      announce(section ? movedTo(exercise.exerciseNameSnapshot, section.name) : movedOut(exercise.exerciseNameSnapshot));
      onMoved(exercise.id, sectionId);
    } catch (error) {
      await fail("set-section", error, { inSheet: false, focus: null, exerciseId, retry: () => void moveExercise(exerciseId, sectionId) });
      if (pendingFocus.current === null) pendingFocus.current = { kind: "select", exerciseId };
    } finally {
      end();
    }
  }

  return {
    sheet,
    sheetView: view === null ? null : { session: view.session, mode: view.mode, sectionId: view.sectionId },
    errors,
    busy: submitting || mutations.pending,
    openAdd: () => open("add", null),
    openEdit: (sectionId) => open("edit", sectionId),
    closeSheet: () => closeAll(openerOf(sheet)),
    submitSheet,
    removeOpen,
    requestRemove: () => setRemoveOpen(true),
    cancelRemove: () => {
      setRemoveOpen(false);
      pendingFocus.current = { kind: "remove" };
    },
    confirmRemove: async () => {
      if (sheet?.mode !== "edit" || sheet.sectionId === null) return;
      await removeSection(sheet.sectionId);
    },
    setExerciseSection,
    addSectionRef,
    editRefFor,
    removeRef,
  };
}
