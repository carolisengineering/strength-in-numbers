import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import type { Routine } from "@sin/core";
import { ROUTINE_ITEMS_MAX } from "@sin/core";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Field } from "../../ui/Field";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { ExercisePicker } from "../catalog/ExercisePicker";
import { EditorRow } from "./EditorRow";
import { useExerciseLookup } from "./exerciseLookup";
import { ItemSheet } from "./ItemSheet";
import { LinkToggle } from "./LinkToggle";
import {
  ADJUSTED_NOTICE,
  ITEMS_CAP_MESSAGE,
  LIMIT_MESSAGE,
  LOAD_ONE_FAILED,
  OFFLINE_SAVE,
  RATE_LIMITED,
  ROUTINE_GONE,
  SAVE_FAILED,
} from "./messages";
import { routinePath, WORKOUTS_PATH } from "./paths";
import { useRoutine, useRoutines } from "./queries";
import { reportRoutineUnexpected } from "./reportRoutine";
import { actions, canLink, initialDraft, isLinked, reduce, runPosition, draftFromRoutine } from "./routineDraft";
import { classifyRoutineError } from "./routineErrors";
import { RoutineGone } from "./RoutinePreview";
import styles from "./RoutineEditor.module.css";
import { itemAccessibleName, targetLine } from "./targetFormat";
import { useCreateRoutine, useReplaceRoutine } from "./useRoutineMutations";
import {
  FORM_INVALID,
  issueForPath,
  NAME_TAKEN,
  nameTaken,
  splitPath,
  toRoutineInput,
  validateDraft,
  type DraftIssue,
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
      <Screen title="Edit routine">
        <p role="status">Loading routine…</p>
      </Screen>
    );
  }
  if (lookup.status === "not-found") return <RoutineGone />;
  if (lookup.status === "error") {
    return (
      <Screen title="Edit routine">
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

export function RoutineEditor({ routine }: { routine: Routine | null }) {
  const [draft, dispatch] = useReducer(reduce, routine, (r) => (r ? draftFromRoutine(r) : initialDraft()));
  const navigate = useNavigate();
  const lookupExercise = useExerciseLookup();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheet, setSheet] = useState<{ key: string; session: number; open: boolean } | null>(null);
  const mainControls = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | "add" | null>(null);

  const validation = useMemo(
    () => validateDraft(draft, { exerciseState: (id) => lookupExercise(id).state }),
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
  const saving = create.isPending || replace.isPending;
  const canSave = validation.ok && !saving && !gone;

  async function save() {
    setAttempted(true);
    if (!validation.ok || gone || inFlight.current) return;
    inFlight.current = true;
    const sent = draft;
    const body = toRoutineInput(sent);
    const keys = sent.items.map((i) => i.key);
    setFormError(null);
    setServerIssues(null);
    try {
      const saved = routine ? await replace.mutateAsync({ id: routine.id, body }) : await create.mutateAsync(body);
      leaving.current = true; // disarm the leave guard before navigating (AC34)
      navigate(routinePath(saved.id), { replace: true });
    } catch (caught) {
      reportRoutineUnexpected("save-routine", caught);
      const failure = classifyRoutineError(caught);
      switch (failure.kind) {
        case "name-taken":
          setTakenName(sent.name);
          nameInput.current?.focus();
          break;
        case "limit":
          setFormError({ text: LIMIT_MESSAGE, requestId: null });
          break;
        case "retired":
          dispatch(actions.markRetired(failure.retiredIndexes.flatMap((i) => (keys[i] === undefined ? [] : [keys[i]!]))));
          break;
        case "validation": {
          const mapped = failure.fieldErrors.map((e) => issueForPath(splitPath(e.path), keys));
          setServerIssues({ draft: sent, issues: mapped.filter((i): i is DraftIssue => i !== null) });
          if (mapped.some((i) => i === null)) setFormError({ text: FORM_INVALID, requestId: failure.requestId });
          break;
        }
        case "not-found":
          setGone(true);
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
    } finally {
      inFlight.current = false;
    }
  }

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target === "add") document.getElementById("routine-add-exercise")?.focus();
    else mainControls.current.get(target)?.focus();
  });

  const cancelTo = routine ? routinePath(routine.id) : WORKOUTS_PATH;
  const sheetItem = sheet ? draft.items.find((i) => i.key === sheet.key) : undefined;
  const groups = draft.items.map((i) => i.supersetGroup);

  return (
    <Screen title={routine ? "Edit routine" : "New routine"}>
      <div className={styles.header}>
        <Button variant="secondary" onClick={() => navigate(cancelTo)}>
          Cancel
        </Button>
        <Button busy={saving} disabled={!canSave} onClick={() => void save()}>
          Save
        </Button>
      </div>
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
      {draft.adjusted ? <InlineNotice onDismiss={() => dispatch(actions.dismissAdjusted())}>{ADJUSTED_NOTICE}</InlineNotice> : null}
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
      <ul className={styles.items} aria-label="Exercises">
        {draft.items.map((item, index) => {
          const exercise = lookupExercise(item.exerciseId);
          const position = runPosition(groups, index);
          const group = position === "none" ? null : item.supersetGroup;
          const line = targetLine(item);
          const unavailable = item.retired === true || exercise.state === "retired" || exercise.state === "missing";
          const next = draft.items[index + 1];
          const refusal = canLink(draft, index);
          return (
            <li key={item.key} className={styles.item} data-name={exercise.name}>
              <EditorRow
                name={exercise.name}
                line={line}
                notes={item.notes}
                position={position}
                accessibleName={itemAccessibleName(exercise.name, group, line, unavailable)}
                unavailable={unavailable}
                error={issueFor(issues, "item", item.key)}
                errorId={`row-${item.key}-error`}
                isFirst={index === 0}
                isLast={index === draft.items.length - 1}
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
        })}
      </ul>
      {issueFor(issues, "items") ? (
        <p id="routine-items-error" className={styles.reason} role={attempted ? "alert" : undefined}>
          {issueFor(issues, "items")}
        </p>
      ) : null}
      <Button
        id="routine-add-exercise"
        variant="secondary"
        disabled={draft.items.length >= ROUTINE_ITEMS_MAX}
        {...(draft.items.length >= ROUTINE_ITEMS_MAX ? { "aria-describedby": "routine-items-cap" } : {})}
        onClick={() => setPickerOpen(true)}
      >
        Add exercise
      </Button>
      {draft.items.length >= ROUTINE_ITEMS_MAX ? (
        <p id="routine-items-cap" className={styles.reason}>
          {ITEMS_CAP_MESSAGE}
        </p>
      ) : null}
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
          key={sheet.session}
          open={sheet.open}
          title={lookupExercise(sheetItem.exerciseId).name}
          item={sheetItem}
          onDone={(targets, notes) => {
            dispatch(actions.setTargets(sheetItem.key, targets, notes));
            setSheet((s) => s && { ...s, open: false });
          }}
          onClose={() => setSheet((s) => s && { ...s, open: false })}
        />
      ) : null}
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Discard changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </Screen>
  );
}
