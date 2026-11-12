import { useId, useState } from "react";
import { PLANNED_SETS_PER_ITEM_MAX, type SetType, type WeightUnit } from "@sin/core";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { ChevronDownIcon } from "../../ui/icons";
import { Segmented } from "../../ui/Segmented";
import type { PlanRowText, RowErrors } from "./planRows";
import { CHECK_THIS_SET, planRowSummary, SET_TYPE_CHOICES } from "./planRowSummary";
import styles from "./PlanRowList.module.css";

/** kg / lb for the plan and the quick line (Spec 17.7 AC6: a Segmented, where `UnitToggle` was). */
export const WEIGHT_UNIT_CHOICES: readonly { value: WeightUnit; label: string }[] = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
];

export interface PlanRowListProps {
  rows: readonly PlanRowText[];
  showReps: boolean;
  showWeight: boolean;
  unit: WeightUnit | "mixed";
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
export function PlanRowList({ rows, showReps, showWeight, unit, errors, openFirst = false, onField, onAdd, onRemove, onMove, onUnit }: PlanRowListProps) {
  const prefix = useId();
  const [openKey, setOpenKey] = useState<string | null>(() => (rows.length === 1 || openFirst ? (rows[0]?.key ?? null) : null));
  const atCap = rows.length >= PLANNED_SETS_PER_ITEM_MAX;
  const onlyRow = rows.length === 1;
  const capId = `${prefix}-cap`;
  const minId = `${prefix}-min`;

  const add = () => {
    const key = crypto.randomUUID();
    setOpenKey(key);
    onAdd(key);
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
          const error = errors.get(row.key);
          const isOpen = openKey === row.key;
          const first = index === 0;
          const last = index === rows.length - 1;
          const summary = planRowSummary(row, { n, showReps, showWeight, unit });
          const flagged = Boolean(error?.reps || error?.weight);
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
                    <Field id={id("reps")} label={`Set ${n} reps`} {...(error?.reps ? { error: error.reps } : {})}>
                      {(control) => <input {...control} type="text" inputMode="text" autoComplete="off" className={styles.input} value={row.reps} onChange={(e) => onField(row.key, { reps: e.target.value })} />}
                    </Field>
                  ) : null}
                  {showWeight ? (
                    <div className={styles.withUnit}>
                      <Field id={id("weight")} label={`Set ${n} weight`} {...(error?.weight ? { error: error.weight } : {})}>
                        {(control) => <input {...control} type="text" inputMode="decimal" autoComplete="off" className={styles.input} value={row.weight} onChange={(e) => onField(row.key, { weight: e.target.value })} />}
                      </Field>
                      {unit === "mixed" && row.weight.trim() !== "" && row.weightUnit !== null ? <span className={styles.rowUnit}>{row.weightUnit}</span> : null}
                    </div>
                  ) : null}
                  <div className={styles.actions}>
                    <Button
                      id={id("moveUp")}
                      variant="secondary"
                      disabled={first}
                      aria-label={`Move up, set ${n}`}
                      {...(first ? { "aria-describedby": id("first") } : {})}
                      onClick={() => onMove(row.key, -1)}
                    >
                      Move up
                    </Button>
                    <Button
                      id={id("moveDown")}
                      variant="secondary"
                      disabled={last}
                      aria-label={`Move down, set ${n}`}
                      {...(last ? { "aria-describedby": id("last") } : {})}
                      onClick={() => onMove(row.key, 1)}
                    >
                      Move down
                    </Button>
                    <Button variant="danger" disabled={onlyRow} aria-label={`Remove, set ${n}`} {...(onlyRow ? { "aria-describedby": minId } : {})} onClick={() => onRemove(row.key)}>
                      Remove
                    </Button>
                  </div>
                  {/* Spec 17.11 AC14, D6: a dead edge button says why, in words beside it. */}
                  {first ? (
                    <p id={id("first")} className={styles.note}>
                      First set
                    </p>
                  ) : null}
                  {last ? (
                    <p id={id("last")} className={styles.note}>
                      Last set
                    </p>
                  ) : null}
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
