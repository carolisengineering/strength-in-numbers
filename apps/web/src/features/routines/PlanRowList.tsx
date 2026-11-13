import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PLANNED_SETS_PER_ITEM_MAX, type SetType, type WeightUnit } from "@sin/core";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { ChevronDownIcon } from "../../ui/icons";
import { Segmented } from "../../ui/Segmented";
import type { PlanRowText, RowErrors } from "./planRows";
import { CHECK_THIS_SET, planRowSummary, SET_TYPE_CHOICES } from "./planRowSummary";
import { useClearOnEdit } from "../../ui/useClearOnEdit";
import styles from "./PlanRowList.module.css";

/** kg / lb for the plan and the quick line (Spec 17.7 AC6: a Segmented, where `UnitToggle` was). */
export const WEIGHT_UNIT_CHOICES: readonly { value: WeightUnit; label: string }[] = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
];

interface PendingFocus {
  readonly key: string;
  readonly target: "summary" | "moveUp" | "moveDown" | "type" | "reps" | "weight";
}

/** The first row, in row order, with a reps or weight error (Spec 17.11 AC16); `null` when none has one. */
export function firstInvalidKey(rows: readonly PlanRowText[], errors: ReadonlyMap<string, RowErrors>): string | null {
  return rows.find((row) => Boolean(errors.get(row.key)?.reps || errors.get(row.key)?.weight))?.key ?? null;
}

export interface PlanRowListProps {
  rows: readonly PlanRowText[];
  showReps: boolean;
  showWeight: boolean;
  unit: WeightUnit | "mixed";
  /** While mixed, the unit Done saves a unitless row in, shown on its line and beside its Weight (minor 519). */
  fallbackUnit?: WeightUnit;
  errors: ReadonlyMap<string, RowErrors>;
  /** Spec 17.11 AC12: the first row starts open (the plan was just entered from the quick line). */
  openFirst?: boolean;
  onField: (rowKey: string, patch: Partial<Pick<PlanRowText, "setType" | "reps" | "weight">>) => void;
  /** The list mints the new row's key, so it can open that row in the same step. */
  onAdd: (rowKey: string) => void;
  onRemove: (rowKey: string) => void;
  onMove: (rowKey: string, dir: -1 | 1) => void;
  onUnit: (unit: WeightUnit) => void;
}

/**
 * The planned sets (Spec 10.2 AC13, Spec 17.11 Phase B). Each set is one line, a button whose text is its summary
 * (`planRowSummary`); a tap opens it in place as a group "Set k" with Type (a Segmented across the row, Spec 17.7),
 * Reps, Weight and Move up / Move down / Remove. One row is open at a time, and which one is view state (`openKey`),
 * never the rows'. Controlled: the item sheet owns the rows and the pure ops in `planRows.ts`. Disabled controls say
 * why in text (P6), the edge Move buttons included ("First set", "Last set", Spec 17.11 D6).
 * (The file is `PlanRowList`, not `PlanRows`: that name differs from `planRows.ts` only by case.)
 */
export function PlanRowList({ rows, showReps, showWeight, unit, fallbackUnit, errors, openFirst = false, onField, onAdd, onRemove, onMove, onUnit }: PlanRowListProps) {
  const prefix = useId();
  // A row the editor or the server already flagged starts open (Spec 17.11 AC16), with no focus move: the sheet's
  // own first focus stands. Otherwise AC12: the only row, or the first when just entered from the quick line.
  const [openKey, setOpenKey] = useState<string | null>(
    () => firstInvalidKey(rows, errors) ?? (rows.length === 1 || openFirst ? (rows[0]?.key ?? null) : null),
  );
  const pendingFocus = useRef<PendingFocus | null>(null);
  const lastErrors = useRef(errors);
  // Minor 521: a row's message shows from the Done that found it until the lifter edits that field. The map from the
  // sheet is never filtered (a new map means a new Done, which opens and focuses the first invalid row); the hiding
  // happens here, keyed by row and field, and resets with the map.
  const flatErrors = useMemo(() => {
    const flat: Record<string, string | undefined> = {};
    for (const [key, e] of errors) {
      flat[`${key}:reps`] = e.reps;
      flat[`${key}:weight`] = e.weight;
    }
    return flat;
  }, [errors]);
  const shown = useClearOnEdit(flatErrors);
  const atCap = rows.length >= PLANNED_SETS_PER_ITEM_MAX;
  const onlyRow = rows.length === 1;
  const capId = `${prefix}-cap`;
  const minId = `${prefix}-min`;

  // AC16: the sheet hands over a new map on every Done, so a failing Done opens the first invalid row and focuses
  // its first invalid field, even when that row is already open. An empty map (a clean Done, Back) does nothing.
  useLayoutEffect(() => {
    if (errors === lastErrors.current) return;
    lastErrors.current = errors;
    const key = firstInvalidKey(rows, errors);
    if (key === null) return;
    setOpenKey(key);
    pendingFocus.current = { key, target: errors.get(key)?.reps ? "reps" : "weight" };
  }, [errors, rows]);

  // AC17: focus that a Move, Remove, Add or failing Done asked for, applied once the rows it names are drawn. A Move
  // re-inserts the row's node, which blurs the pressed button in Chromium and Safari, so focus is put back by id.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null) return;
    const panel = document.getElementById(`${prefix}-${pending.key}-panel`);
    const summary = document.getElementById(`${prefix}-${pending.key}-summary`);
    let target: HTMLElement | null;
    if (pending.target === "summary") target = summary;
    else if (pending.target === "type") target = panel?.querySelector<HTMLElement>('input[type="radio"]:checked') ?? panel?.querySelector<HTMLElement>('input[type="radio"]') ?? null;
    else target = document.getElementById(`${prefix}-${pending.key}-${pending.target}`);
    // The row isn't open yet (its open lands in the next render): keep waiting for it.
    if (target === null && pending.target !== "summary" && openKey !== pending.key && summary !== null) return;
    pendingFocus.current = null;
    if (target instanceof HTMLButtonElement && target.disabled) target = summary;
    target?.focus();
  });

  const add = () => {
    const key = crypto.randomUUID();
    setOpenKey(key);
    pendingFocus.current = { key, target: "type" };
    onAdd(key);
  };
  const move = (key: string, dir: -1 | 1) => {
    pendingFocus.current = { key, target: dir < 0 ? "moveUp" : "moveDown" };
    onMove(key, dir);
  };
  const remove = (index: number) => {
    const takesPlace = rows[index + 1] ?? rows[index - 1];
    // Spec 17.11 AC12 (minor 526): a Remove that leaves one row opens it; otherwise every row closes.
    setOpenKey(rows.length === 2 && takesPlace ? takesPlace.key : null);
    if (takesPlace) pendingFocus.current = { key: takesPlace.key, target: "summary" };
    onRemove(rows[index]!.key);
  };

  return (
    <div className={styles.plan}>
      {/* Spec 10.2 AC13 / D3: "mixed" checks neither unit, so rows in different units never look like they match. */}
      {showWeight ? <Segmented name={`${prefix}-unit`} legend="Weight unit" options={WEIGHT_UNIT_CHOICES} value={unit === "mixed" ? null : unit} onChange={onUnit} /> : null}
      {showWeight && unit === "mixed" ? <p className={styles.note}>Mixed units — pick one to use for all sets</p> : null}
      <ol className={styles.rows} aria-label="Planned sets">
        {rows.map((row, index) => {
          const n = index + 1;
          const id = (name: string) => `${prefix}-${row.key}-${name}`;
          const repsError = shown.of(`${row.key}:reps`);
          const weightError = shown.of(`${row.key}:weight`);
          const isOpen = openKey === row.key;
          const first = index === 0;
          const last = index === rows.length - 1;
          const summary = planRowSummary(row, { n, showReps, showWeight, unit, ...(fallbackUnit ? { fallbackUnit } : {}) });
          const rowUnit = row.weightUnit ?? fallbackUnit ?? null;
          // Spec 17.11 AC16: only a closed row carries the suffix; the open one shows its messages by its fields.
          const flagged = !isOpen && Boolean(repsError || weightError);
          return (
            <li key={row.key} className={styles.row}>
              <button
                type="button"
                id={id("summary")}
                className={styles.summary}
                aria-expanded={isOpen}
                {...(isOpen ? { "aria-controls": id("panel") } : {})}
                onClick={() => setOpenKey(isOpen ? null : row.key)}
              >
                <span className={styles.summaryText}>{flagged ? `${summary} · ${CHECK_THIS_SET}` : summary}</span>
                <ChevronDownIcon className={isOpen ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron} />
              </button>
              {isOpen ? (
                <div id={id("panel")} role="group" aria-label={`Set ${n}`} className={styles.panel}>
                  {/* Spec 17.7 AC6: the row's own radio name, so choosing one row's type never unchecks another's. */}
                  <div className={styles.type}>
                    <Segmented<SetType> name={id("type")} legend={`Set ${n} type`} options={SET_TYPE_CHOICES} value={row.setType} onChange={(setType) => onField(row.key, { setType })} />
                  </div>
                  {showReps ? (
                    <Field id={id("reps")} label={`Set ${n} reps`} error={repsError}>
                      {(control) => <input {...control} type="text" inputMode="text" autoComplete="off" className={styles.input} value={row.reps} onChange={(e) => {
                          shown.edit(`${row.key}:reps`);
                          onField(row.key, { reps: e.target.value });
                        }} />}
                    </Field>
                  ) : null}
                  {showWeight ? (
                    <div className={styles.withUnit}>
                      <Field id={id("weight")} label={`Set ${n} weight`} error={weightError}>
                        {(control) => <input {...control} type="text" inputMode="decimal" autoComplete="off" className={styles.input} value={row.weight} onChange={(e) => {
                          shown.edit(`${row.key}:weight`);
                          onField(row.key, { weight: e.target.value });
                        }} />}
                      </Field>
                      {unit === "mixed" && row.weight.trim() !== "" && rowUnit !== null ? <span className={styles.rowUnit}>{rowUnit}</span> : null}
                    </div>
                  ) : null}
                  {/* Spec 17.11 AC14, D6: a dead edge button says why, in words beside it. Each edge button and its note are
                      one item of the row (minor 523), so a wrap at 320 px never leaves a note before Remove. */}
                  <div className={styles.actions}>
                    <span className={styles.edge}>
                      <Button
                        id={id("moveUp")}
                        variant="secondary"
                        disabled={first}
                        aria-label={`Move up, set ${n}`}
                        {...(first ? { "aria-describedby": id("first") } : {})}
                        onClick={() => move(row.key, -1)}
                      >
                        Move up
                      </Button>
                      {first ? (
                        <span id={id("first")} className={styles.note}>
                          First set
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.edge}>
                      <Button
                        id={id("moveDown")}
                        variant="secondary"
                        disabled={last}
                        aria-label={`Move down, set ${n}`}
                        {...(last ? { "aria-describedby": id("last") } : {})}
                        onClick={() => move(row.key, 1)}
                      >
                        Move down
                      </Button>
                      {last ? (
                        <span id={id("last")} className={styles.note}>
                          Last set
                        </span>
                      ) : null}
                    </span>
                    <Button variant="danger" disabled={onlyRow} aria-label={`Remove, set ${n}`} {...(onlyRow ? { "aria-describedby": minId } : {})} onClick={() => remove(index)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {onlyRow ? (
        <p id={minId} className={styles.note}>
          A plan needs at least one set
        </p>
      ) : null}
      <Button variant="secondary" disabled={atCap} {...(atCap ? { "aria-describedby": capId } : {})} onClick={add}>
        Add set
      </Button>
      {atCap ? (
        <p id={capId} className={styles.note}>
          Up to {PLANNED_SETS_PER_ITEM_MAX} sets
        </p>
      ) : null}
    </div>
  );
}
