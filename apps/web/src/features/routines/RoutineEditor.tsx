import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useLocation, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Routine } from "@sin/core";
import { ROUTINE_ITEMS_MAX, ROUTINE_SECTIONS_MAX } from "@sin/core";
import { ActionBar } from "../../ui/ActionBar";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Field } from "../../ui/Field";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { useSession } from "../../auth/useSession";
import { ExercisePicker } from "../catalog/ExercisePicker";
import { EditorRow } from "./EditorRow";
import { useExerciseLookup } from "./exerciseLookup";
import { AddSectionSheet } from "./AddSectionSheet";
import { ItemSheet } from "./ItemSheet";
import { LinkToggle } from "./LinkToggle";
import { MoveToSectionSheet } from "./MoveToSectionSheet";
import { SectionHeader } from "./SectionHeader";
import { SectionSheet } from "./SectionSheet";
import sectionStyles from "./Sections.module.css";
import {
  ADJUSTED_NOTICE,
  ITEMS_CAP_MESSAGE,
  LIMIT_MESSAGE,
  LOAD_ONE_FAILED,
  OFFLINE_SAVE,
  RATE_LIMITED,
  ROUTINE_GONE,
  SAVE_FAILED,
  SECTION_EMPTY_HINT,
  SECTION_UNLINK_NOTICE,
  SECTIONS_CAP_MESSAGE,
} from "./messages";
import { cameFromBack, routinePath, WORKOUTS_PATH } from "./paths";
import { ROUTINE_KEYS, useRoutine, useRoutines } from "./queries";
import { reportRoutineUnexpected } from "./reportRoutine";
import { actions, canLink, initialDraft, isLinked, plannedRowsOf, reduce, runPosition, draftFromRoutine, type Draft } from "./routineDraft";
import { classifyRoutineError, serverIssuesFor } from "./routineErrors";
import { BackToWorkouts, RoutineGone } from "./RoutinePreview";
import { fieldMessagesFor, itemMessage, rowMessagesFor, sectionError, sectionMessagesFor } from "./sheetIssues";
import styles from "./RoutineEditor.module.css";
import { itemAccessibleName, targetLine } from "./targetFormat";
import { useCreateRoutine, useReplaceRoutine } from "./useRoutineMutations";
import {
  FORM_INVALID,
  NAME_TAKEN,
  nameTaken,
  toRoutineInput,
  validateDraft,
  type DraftIssue,
  type RoutineWriteInput,
} from "./validateDraft";

export function RoutineEditorRoute({ mode }: { mode: "create" | "edit" }) {
  const { id = "" } = useParams();
  if (mode === "create") return <RoutineEditor key="new" routine={null} />;
  return <EditLoader key={id} id={id} />;
}

function EditLoader({ id }: { id: string }) {
  const lookup = useRoutine(id);
  const error = lookup.status === "error" ? lookup.error : null;
  useEffect(() => {
    if (error) reportRoutineUnexpected("load-routine", error);
  }, [error]);
  if (lookup.status === "pending") {
    return (
      <Screen title="Edit routine" lead={<BackToWorkouts />}>
        <p role="status">Loading routine…</p>
      </Screen>
    );
  }
  if (lookup.status === "not-found") return <RoutineGone />;
  if (lookup.status === "error") {
    return (
      <Screen title="Edit routine" lead={<BackToWorkouts />}>
        <InlineNotice tone="error" requestId={classifyRoutineError(lookup.error).requestId} actionLabel="Retry" onAction={lookup.retry}>
          {LOAD_ONE_FAILED}
        </InlineNotice>
      </Screen>
    );
  }
  // The draft is built once, from this first loaded routine (AC25): later cache updates never reset it.
  return <RoutineEditor routine={lookup.routine} />;
}

/** Where to show each issue (AC31). */
function issueFor(issues: readonly DraftIssue[], scope: DraftIssue["scope"], itemKey?: string): string | null {
  const found = issues.find((i) => i.scope === scope && (itemKey === undefined || (i.scope === "item" && i.itemKey === itemKey)));
  return found ? found.message : null;
}

/** Spec 10.4 AC31: what Save sends after `prepareBody`, or why it stopped (a form-level message). */
export type PreparedBody =
  | { readonly ok: true; readonly body: RoutineWriteInput }
  | { readonly ok: false; readonly message: string; readonly requestId: string | null };

/** Spec 10.4 AC30: a "New routine" editor that starts from a given draft (an import). Only with `routine === null`. */
export interface EditorStart {
  readonly draft: Draft;
  /** Rendered above the form, before any error notice. */
  readonly notices?: ReactNode;
  /** Awaited by Save before the routine write (an import creates its pending exercises here). */
  readonly prepareBody?: (body: RoutineWriteInput, draft: Draft, signal: AbortSignal) => Promise<PreparedBody>;
  /** Spec 10.5 AC17 / D8: an import's create is a one-off, with or without pending exercises. Set only by `ImportEditRoute`. */
  readonly oneOff?: true;
  /** Where a saved create goes instead of replacing the editor with its preview (the import gives up its history entries). */
  readonly leaveTo?: (path: string) => void;
}

export function RoutineEditor({ routine, initial }: { routine: Routine | null; initial?: EditorStart }) {
  const [draft, dispatch] = useReducer(reduce, routine, (r) => (r ? draftFromRoutine(r) : (initial?.draft ?? initialDraft())));
  const navigate = useNavigate();
  const { user } = useSession();
  const queryClient = useQueryClient();
  /** Opened from a screen one Back away: leave by going Back, so history stays [..., that screen]. */
  const back = cameFromBack(useLocation().state);
  const lookupExercise = useExerciseLookup();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheet, setSheet] = useState<{ key: string; session: number; open: boolean } | null>(null);
  const [sectionSheet, setSectionSheet] = useState<{ key: string; session: number; open: boolean } | null>(null);
  const [addSheet, setAddSheet] = useState<{ session: number; open: boolean } | null>(null);
  const [moveSheet, setMoveSheet] = useState<{ itemKey: string; session: number; open: boolean } | null>(null);
  // The native <dialog> restores focus to its opener on close; after "Move to section" the opener's row has
  // moved to another list, so focus is set here AFTER the Sheet's own effect (child effects run first).
  const focusAfterSheet = useRef<string | null>(null);
  useEffect(() => {
    const target = focusAfterSheet.current;
    if (target === null) return;
    focusAfterSheet.current = null;
    mainControls.current.get(target)?.focus();
  });
  const mainControls = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | "add" | "add-section" | null>(null);

  const validation = useMemo(
    () => validateDraft(draft, { exerciseState: (id) => lookupExercise(id).state, modalityOf: (id) => lookupExercise(id).modality }),
    [draft, lookupExercise],
  );
  const routines = useRoutines();
  const create = useCreateRoutine();
  const replace = useReplaceRoutine();
  const [attempted, setAttempted] = useState(false);
  const [gone, setGone] = useState(false);
  const [formError, setFormError] = useState<{ text: string; requestId: string | null } | null>(null);
  /** Server-side name conflict, kept while the name is unchanged. */
  const [takenName, setTakenName] = useState<string | null>(null);
  /** Field issues from a 422, valid only for the exact draft that was sent (they vanish on the next edit). */
  const [serverIssues, setServerIssues] = useState<{ draft: typeof draft; issues: DraftIssue[] } | null>(null);
  const inFlight = useRef(false);
  const leaving = useRef(false);
  /** False once the editor unmounts: a save that lands after the lifter left must not move them. */
  const mounted = useRef(true);
  /** Cache cleanup for a routine the server says is gone — run on unmount, so this editor's own lookup
   * does not refetch and replace the draft (and its notice) while the lifter is still reading it. */
  const gonePending = useRef<(() => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      gonePending.current?.();
    };
  }, []);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const reportedBug = useRef(false);

  useEffect(() => {
    if (validation.groupBug && !reportedBug.current) {
      reportedBug.current = true;
      reportRoutineUnexpected("validate-draft", new Error("superset invariant broken"));
    }
  }, [validation.groupBug]);

  // AC34 / D17: in-app navigation (Cancel, nav links, Back) through the data router's blocker; reload and
  // tab close through the browser's own prompt. A save sets `leaving` before it navigates.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => draft.dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!draft.dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [draft.dirty]);

  const showErrors = draft.dirty || attempted;
  const issues: DraftIssue[] = [
    ...(showErrors ? validation.issues : []),
    ...(serverIssues?.draft === draft ? serverIssues.issues : []),
    ...(takenName !== null && takenName === draft.name ? [{ scope: "name" as const, message: NAME_TAKEN }] : []),
  ];
  const duplicateWarning =
    routines.data !== undefined && nameTaken(draft.name, routines.data, routine?.id) ? NAME_TAKEN : null;
  const [saved, setSaved] = useState(false);
  /** Spec 10.4 AC31: `initial.prepareBody` is running (an import creating its exercises): Save is busy, the form locked. */
  const [preparing, setPreparing] = useState(false);
  /** Aborted when the editor unmounts, so a discarded Save stops between `prepareBody`'s steps. */
  const prepareAbort = useRef(new AbortController());
  useEffect(() => {
    // A fresh controller per mount: StrictMode's dev re-mount must not leave Save with an aborted signal.
    const controller = new AbortController();
    prepareAbort.current = controller;
    return () => controller.abort();
  }, []);
  const saving = create.isPending || replace.isPending || saved || preparing;
  const [focusName, setFocusName] = useState(false);
  useEffect(() => {
    if (!focusName || saving) return;
    setFocusName(false);
    nameInput.current?.focus();
  }, [focusName, saving]);
  const canSave = validation.ok && !saving && !gone;

  async function save() {
    setAttempted(true);
    if (!validation.ok || gone || inFlight.current) return;
    inFlight.current = true;
    const sent = draft;
    let body = toRoutineInput(sent, { modalityOf: (id) => lookupExercise(id).modality });
    const keys = sent.items.map((i) => i.key);
    setFormError(null);
    setServerIssues(null);
    try {
      if (initial?.prepareBody) {
        setPreparing(true);
        let prepared: PreparedBody;
        try {
          prepared = await initial.prepareBody(body, sent, prepareAbort.current.signal);
        } finally {
          if (mounted.current) setPreparing(false);
        }
        // Discarded while the exercises were being created: write no routine (what was created stays, Spec 10.4 D5).
        if (!mounted.current) {
          inFlight.current = false;
          return;
        }
        if (!prepared.ok) {
          inFlight.current = false;
          setFormError({ text: prepared.message, requestId: prepared.requestId });
          return;
        }
        body = prepared.body;
      }
      const saved = routine ? await replace.mutateAsync({ id: routine.id, body }) : await create.mutateAsync(initial?.oneOff ? { body, oneOff: true } : { body });
      leaving.current = true; // disarm the leave guard before navigating (AC34)
      // The latch stays closed: until the editor unmounts, a late second tap must not send a second write.
      setSaved(true);
      if (!mounted.current) return;
      if (routine && back) navigate(-1); // the preview behind us reads the saved copy from the cache
      else if (initial?.leaveTo) initial.leaveTo(routinePath(saved.id));
      else navigate(routinePath(saved.id), { replace: true });
    } catch (caught) {
      inFlight.current = false; // only a failure reopens Save
      reportRoutineUnexpected("save-routine", caught);
      const failure = classifyRoutineError(caught);
      switch (failure.kind) {
        case "name-taken":
          setTakenName(sent.name);
          setFocusName(true); // after the form unlocks: a disabled input cannot take focus
          break;
        case "limit":
          setFormError({ text: LIMIT_MESSAGE, requestId: null });
          break;
        case "retired":
          dispatch(actions.markRetired(failure.retiredIndexes.flatMap((i) => (keys[i] === undefined ? [] : [keys[i]!]))));
          break;
        case "validation": {
          const { issues: mapped, unmatched } = serverIssuesFor(failure.fieldErrors, sent);
          setServerIssues({ draft: sent, issues: mapped });
          if (unmatched) setFormError({ text: FORM_INVALID, requestId: failure.requestId });
          break;
        }
        case "not-found":
          setGone(true);
          // Deleted elsewhere: forget it, so no list or preview offers it again (the editor shows the notice).
          if (routine) {
            const goneId = routine.id;
            gonePending.current = () => {
              queryClient.removeQueries({ queryKey: ROUTINE_KEYS.detail(goneId), exact: true });
              queryClient.setQueryData<Routine[]>(ROUTINE_KEYS.list, (old) => old?.filter((r) => r.id !== goneId));
            };
          }
          break;
        case "rate-limited":
          setFormError({ text: RATE_LIMITED, requestId: null });
          break;
        case "network":
          setFormError({ text: OFFLINE_SAVE, requestId: null });
          break;
        default:
          setFormError({ text: SAVE_FAILED, requestId: failure.requestId });
      }
    }
  }

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === "add") document.getElementById("routine-add-exercise")?.focus();
    else if (target === "add-section") document.getElementById("routine-add-section")?.focus();
    else mainControls.current.get(target)?.focus();
  });

  const itemsError = issueFor(issues, "items");
  const addDescribedBy =
    [itemsError ? "routine-items-error" : null, draft.items.length >= ROUTINE_ITEMS_MAX ? "routine-items-cap" : null]
      .filter(Boolean)
      .join(" ") || undefined;
  const cancelTo = routine ? routinePath(routine.id) : WORKOUTS_PATH;
  const sheetItem = sheet ? draft.items.find((i) => i.key === sheet.key) : undefined;
  const groups = draft.items.map((i) => i.supersetGroup);
  const looseCount = draft.items.filter((i) => i.sectionKey === null).length;
  const sectionBounds = (() => {
    let from = looseCount;
    return draft.sections.map((s): [number, number] => {
      const to = from + draft.items.filter((i) => i.sectionKey === s.key).length;
      const range: [number, number] = [from, to];
      from = to;
      return range;
    });
  })();
  const sheetSection = sectionSheet ? draft.sections.find((s) => s.key === sectionSheet.key) : undefined;
  const sectionsAtCap = draft.sections.length >= ROUTINE_SECTIONS_MAX;

  function renderRow(index: number, start: number, end: number) {
    const item = draft.items[index]!;
    const exercise = lookupExercise(item.exerciseId);
    const position = runPosition(groups, index);
    const group = position === "none" ? null : item.supersetGroup;
    const line = targetLine(item, plannedRowsOf(item));
    const unavailable = item.retired === true || exercise.state === "retired" || exercise.state === "missing";
    const next = index + 1 < end ? draft.items[index + 1] : undefined; // a toggle exists only inside one section run
    const refusal = canLink(draft, index);
    return (
      <li key={item.key} className={styles.item} data-name={exercise.name}>
        <EditorRow
          name={exercise.name}
          line={line}
          notes={item.notes}
          position={position}
          accessibleName={itemAccessibleName(exercise.isNew ? `${exercise.name} (New)` : exercise.name, group, line, unavailable)}
          isNew={exercise.isNew === true}
          unavailable={unavailable}
          error={itemMessage(issues, item.key)}
          errorId={`row-${item.key}-error`}
          isFirst={index === start}
          isLast={index === end - 1}
          registerMain={(el) => {
            if (el) mainControls.current.set(item.key, el);
            else mainControls.current.delete(item.key);
          }}
          onOpen={() => setSheet((s) => ({ key: item.key, session: (s?.session ?? 0) + 1, open: true }))}
          onMoveUp={() => {
            pendingFocus.current = item.key;
            dispatch(actions.moveUp(item.key));
          }}
          onMoveDown={() => {
            pendingFocus.current = item.key;
            dispatch(actions.moveDown(item.key));
          }}
          {...(draft.sections.length > 0
            ? { onMoveToSection: () => setMoveSheet((s) => ({ itemKey: item.key, session: (s?.session ?? 0) + 1, open: true })) }
            : {})}
          onRemove={() => {
            pendingFocus.current = draft.items[index + 1]?.key ?? "add";
            dispatch(actions.remove(item.key));
          }}
        />
        {next ? (
          <LinkToggle
            id={`link-${item.key}`}
            above={exercise.name}
            below={lookupExercise(next.exerciseId).name}
            linked={isLinked(draft.items, index)}
            refusal={refusal.ok ? null : refusal.reason}
            onToggle={() => dispatch(actions.toggleLink(index))}
          />
        ) : null}
      </li>
    );
  }

  return (
    <Screen title={routine ? "Edit routine" : "New routine"}>
      {initial?.notices}
      {gone ? (
        <InlineNotice tone="error">
          {ROUTINE_GONE}{" "}
          <Link to={WORKOUTS_PATH}>Back to Workouts</Link>
        </InlineNotice>
      ) : null}
      {formError ? (
        <InlineNotice tone="error" requestId={formError.requestId}>
          {formError.text}
        </InlineNotice>
      ) : null}
      {/* Locked while a save is in flight: an edit made then would be lost when the save lands. */}
      <fieldset className={styles.form} disabled={saving}>
      {draft.adjusted ? <InlineNotice onDismiss={() => dispatch(actions.dismissAdjusted())}>{ADJUSTED_NOTICE}</InlineNotice> : null}
      {draft.unlinkNotice ? <InlineNotice onDismiss={() => dispatch(actions.dismissUnlinkNotice())}>{SECTION_UNLINK_NOTICE}</InlineNotice> : null}
      <Field
        id="routine-name"
        label="Name"
        {...(issueFor(issues, "name") ? { error: issueFor(issues, "name")! } : duplicateWarning ? { hint: duplicateWarning } : {})}
      >
        {(control) => (
          <input {...control} ref={nameInput} className={styles.input} value={draft.name} onChange={(e) => dispatch(actions.rename(e.target.value))} />
        )}
      </Field>
      <Field id="routine-notes" label="Notes" hint="Optional" {...(issueFor(issues, "notes") ? { error: issueFor(issues, "notes")! } : {})}>
        {(control) => (
          <textarea {...control} className={styles.input} rows={2} value={draft.notes} onChange={(e) => dispatch(actions.setNotes(e.target.value))} />
        )}
      </Field>
      {draft.sections.length === 0 ? (
        <ul className={styles.items} aria-label="Exercises">
          {draft.items.map((_, index) => renderRow(index, 0, draft.items.length))}
        </ul>
      ) : (
        <>
          {looseCount > 0 ? (
            <ul className={styles.items} aria-label="Exercises">
              {draft.items.slice(0, looseCount).map((_, index) => renderRow(index, 0, looseCount))}
            </ul>
          ) : null}
          {draft.sections.map((section, j) => {
            const [from, to] = sectionBounds[j]!;
            const headingId = `section-${section.key}-name`;
            return (
              <section key={section.key} className={sectionStyles.section} aria-labelledby={headingId}>
                <SectionHeader
                  name={section.name}
                  notes={section.notes}
                  index={j}
                  count={draft.sections.length}
                  headingId={headingId}
                  error={sectionError(issues, section.key)}
                  errorId={`section-${section.key}-error`}
                  registerMain={(el) => {
                    if (el) mainControls.current.set(`section:${section.key}`, el);
                    else mainControls.current.delete(`section:${section.key}`);
                  }}
                  onOpen={() => setSectionSheet((s) => ({ key: section.key, session: (s?.session ?? 0) + 1, open: true }))}
                  onMoveUp={() => {
                    pendingFocus.current = `section:${section.key}`;
                    dispatch(actions.moveSectionUp(section.key));
                  }}
                  onMoveDown={() => {
                    pendingFocus.current = `section:${section.key}`;
                    dispatch(actions.moveSectionDown(section.key));
                  }}
                  onDelete={() => {
                    pendingFocus.current = "add-section";
                    dispatch(actions.deleteSection(section.key));
                  }}
                />
                {to > from ? (
                  <ul className={styles.items} aria-label={`Exercises in ${section.name}`}>
                    {draft.items.slice(from, to).map((_, k) => renderRow(from + k, from, to))}
                  </ul>
                ) : (
                  <p className={sectionStyles.reason}>{SECTION_EMPTY_HINT}</p>
                )}
              </section>
            );
          })}
        </>
      )}
      {issueFor(issues, "items") ? (
        <p id="routine-items-error" className={styles.reason} role={attempted ? "alert" : undefined}>
          {issueFor(issues, "items")}
        </p>
      ) : null}
      <div className={sectionStyles.addRow}>
        <Button
          id="routine-add-section"
          variant="secondary"
          disabled={sectionsAtCap}
          {...(sectionsAtCap ? { "aria-describedby": "routine-sections-cap" } : {})}
          onClick={() => setAddSheet((s) => ({ session: (s?.session ?? 0) + 1, open: true }))}
        >
          Add section
        </Button>
        {sectionsAtCap ? (
          <p id="routine-sections-cap" className={sectionStyles.reason}>
            {SECTIONS_CAP_MESSAGE}
          </p>
        ) : null}
      </div>
      <Button
        id="routine-add-exercise"
        variant="secondary"
        disabled={draft.items.length >= ROUTINE_ITEMS_MAX}
        {...(addDescribedBy ? { "aria-describedby": addDescribedBy } : {})}
        onClick={() => setPickerOpen(true)}
      >
        Add exercise
      </Button>
      {draft.items.length >= ROUTINE_ITEMS_MAX ? (
        <p id="routine-items-cap" className={styles.reason}>
          {ITEMS_CAP_MESSAGE}
        </p>
      ) : null}
      </fieldset>
      {/* O4: Cancel / Save stay reachable over a long list — the bottom bar, in the thumb zone. */}
      <ActionBar>
        <Button variant="secondary" onClick={() => (back ? navigate(-1) : navigate(cancelTo, { replace: true }))}>
          Cancel
        </Button>
        <Button busy={saving} disabled={!canSave} onClick={() => void save()}>
          Save
        </Button>
      </ActionBar>
      <ExercisePicker
        open={pickerOpen}
        onPick={(exercise) => {
          dispatch(actions.add(exercise.id));
          setPickerOpen(false); // the picker never closes itself (06.0)
        }}
        onClose={() => setPickerOpen(false)}
      />
      {sheet && sheetItem ? (
        <ItemSheet
          key={`item-${sheet.session}`}
          open={sheet.open}
          title={lookupExercise(sheetItem.exerciseId).name}
          item={sheetItem}
          modality={lookupExercise(sheetItem.exerciseId).modality}
          defaultUnit={user?.unitPreference ?? "kg"}
          fieldMessages={fieldMessagesFor(issues, sheetItem.key)}
          rowMessages={rowMessagesFor(issues, sheetItem.key)}
          onPlanned={(planned) => dispatch(actions.setPlanned(sheetItem.key, planned))}
          onDone={(targets, notes) => {
            dispatch(actions.setTargets(sheetItem.key, targets, notes));
            setSheet((s) => s && { ...s, open: false });
          }}
          onClose={() => setSheet((s) => s && { ...s, open: false })}
        />
      ) : null}
      {sectionSheet && sheetSection ? (
        <SectionSheet
          key={`section-${sectionSheet.session}`}
          open={sectionSheet.open}
          section={sheetSection}
          messages={sectionMessagesFor(issues, sheetSection.key)}
          onDone={(name, notes) => {
            dispatch(actions.renameSection(sheetSection.key, name));
            dispatch(actions.setSectionNotes(sheetSection.key, notes));
            setSectionSheet((s) => s && { ...s, open: false });
          }}
          onClose={() => setSectionSheet((s) => s && { ...s, open: false })}
        />
      ) : null}
      {addSheet ? (
        <AddSectionSheet
          key={`add-${addSheet.session}`}
          open={addSheet.open}
          onAdd={(name) => {
            dispatch(actions.addSection(name));
            pendingFocus.current = "add-section";
            setAddSheet((s) => s && { ...s, open: false });
          }}
          onClose={() => setAddSheet((s) => s && { ...s, open: false })}
        />
      ) : null}
      {moveSheet && draft.items.some((i) => i.key === moveSheet.itemKey) ? (
        <MoveToSectionSheet
          key={`move-${moveSheet.session}`}
          open={moveSheet.open}
          title={`Move ${lookupExercise(draft.items.find((i) => i.key === moveSheet.itemKey)!.exerciseId).name}`}
          current={draft.items.find((i) => i.key === moveSheet.itemKey)!.sectionKey}
          sections={draft.sections}
          onChoose={(sectionKey) => {
            focusAfterSheet.current = moveSheet.itemKey;
            dispatch(actions.moveItemToSection(moveSheet.itemKey, sectionKey));
            setMoveSheet((s) => s && { ...s, open: false });
          }}
          onClose={() => setMoveSheet((s) => s && { ...s, open: false })}
        />
      ) : null}
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Discard changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={() => {
          // Disarm like a save does: the router reaches the next screen before this editor unmounts, and a
          // Back in that gap must not be blocked by a draft the lifter already discarded (AC34).
          leaving.current = true;
          blocker.proceed?.();
        }}
        onCancel={() => blocker.reset?.()}
      />
    </Screen>
  );
}
