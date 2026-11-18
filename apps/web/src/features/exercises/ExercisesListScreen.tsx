import { useMemo, useRef } from "react";
import { Link, useLocation } from "react-router";

import buttonStyles from "../../ui/Button.module.css";
import { Screen } from "../../ui/Screen";
import choiceStyles from "../progress/ChoiceGroup.module.css";
import { AllExercises } from "./AllExercises";
import { ExercisesTitleContext, type ExercisesTitle } from "./exercisesTitle";
import styles from "./ExercisesLayout.module.css";
import { EXERCISES_COPY } from "./messages";
import { EXERCISES_PATH, RECORDS_PATH } from "./paths";
import { RecordsView } from "./RecordsView";

export type ExercisesView = "all" | "records";

const VIEWS = [
  { view: "all", to: EXERCISES_PATH, label: EXERCISES_COPY.allView },
  { view: "records", to: RECORDS_PATH, label: EXERCISES_COPY.recordsView },
] as const;

/** ChoiceGroup's chip as a link: a secondary Button (≥ 44 px), pressed look when shown. */
const viewClass = (shown: boolean): string =>
  [buttonStyles.button, buttonStyles.secondary, styles.view, shown ? choiceStyles.pressed : null].filter(Boolean).join(" ");

/**
 * The Exercises list (Spec 18.2 AC5): one `Screen`, the view switch, then All exercises or Records. The phone's
 * `/app/exercises` and `/records`, and at desktop widths the list pane beside an exercise (Spec 17.12 AC20), where
 * the title is an `h2`. The views are links (they navigate and deep-link) and they replace, so toggling does not
 * stack history. The shown view is `aria-current="page"` on its own path; beside an exercise it is "true", since the
 * page is the exercise.
 */
export function ExercisesListScreen({ view }: { view: ExercisesView }) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const title = useMemo<ExercisesTitle>(() => ({ titleRef }), []);
  const { pathname } = useLocation();
  return (
    <Screen title={EXERCISES_COPY.title} titleRef={titleRef} hideTitle>
      <nav aria-label={EXERCISES_COPY.viewsLabel} className={styles.views}>
        {VIEWS.map((v) => {
          const shown = v.view === view;
          return (
            <Link
              key={v.view}
              to={v.to}
              replace
              className={viewClass(shown)}
              aria-current={shown ? (pathname === v.to ? "page" : "true") : undefined}
            >
              {v.label}
            </Link>
          );
        })}
      </nav>
      <ExercisesTitleContext.Provider value={title}>{view === "records" ? <RecordsView /> : <AllExercises />}</ExercisesTitleContext.Provider>
    </Screen>
  );
}
