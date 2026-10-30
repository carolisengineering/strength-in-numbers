import type { Step } from "./importSession";
import { STEP_LABELS, STEPS_NAV_LABEL } from "./messages";
import styles from "./ImportScreen.module.css";

type NavStep = keyof typeof STEP_LABELS;

/** Spec 20.1 §5: which of the six named steps a session step belongs to. */
const NAV_OF: Readonly<Record<Step, NavStep>> = {
  preflight: "read",
  reading: "read",
  preparing: "routines",
  routines: "routines",
  markers: "names",
  names: "names",
  saving_names: "names",
  checking: "summary",
  summary: "summary",
  running: "import",
  paused: "import",
  stopped: "import",
  finishing: "import",
  routines_run: "import",
  done: "done",
};

const ORDER: readonly NavStep[] = ["read", "routines", "names", "summary", "import", "done"];

/** §5: "1 Read · 2 Routines · 3 Names · 4 Summary · 5 Import · 6 Done", the current one `aria-current="step"`. */
export function ImportSteps({ step }: { step: Step }) {
  const current = NAV_OF[step];
  return (
    <nav className={styles.steps} aria-label={STEPS_NAV_LABEL}>
      <ol>
        {ORDER.map((s, i) => (
          <li key={s} aria-current={s === current ? "step" : undefined}>
            {i + 1} {STEP_LABELS[s]}
          </li>
        ))}
      </ol>
    </nav>
  );
}
