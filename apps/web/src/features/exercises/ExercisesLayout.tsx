import { useRef, type RefObject } from "react";
import { NavLink, Outlet } from "react-router";

import buttonStyles from "../../ui/Button.module.css";
import { Screen } from "../../ui/Screen";
import choiceStyles from "../progress/ChoiceGroup.module.css";
import styles from "./ExercisesLayout.module.css";
import { EXERCISES_COPY } from "./messages";
import { EXERCISES_PATH, RECORDS_PATH } from "./paths";

/** What the layout hands its views: the `h1`, for a view that moves focus to it (Phase B's notices). */
export type ExercisesOutletContext = { titleRef: RefObject<HTMLHeadingElement | null> };

/** ChoiceGroup's chip as a link: a secondary Button (≥ 44 px), pressed look when current. */
const viewClass = ({ isActive }: { isActive: boolean }): string =>
  [buttonStyles.button, buttonStyles.secondary, styles.view, isActive ? choiceStyles.pressed : null].filter(Boolean).join(" ");

/**
 * The Exercises tab (Spec 18.2 AC5): one `Screen`, then the view switch. The views are links (they
 * navigate and deep-link, so `NavLink` sets `aria-current`), and they replace, so toggling does not
 * stack history.
 */
export function ExercisesLayout() {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const context: ExercisesOutletContext = { titleRef };
  return (
    <Screen title={EXERCISES_COPY.title} titleRef={titleRef}>
      <nav aria-label={EXERCISES_COPY.viewsLabel} className={styles.views}>
        <NavLink to={EXERCISES_PATH} end replace className={viewClass}>
          {EXERCISES_COPY.allView}
        </NavLink>
        <NavLink to={RECORDS_PATH} replace className={viewClass}>
          {EXERCISES_COPY.recordsView}
        </NavLink>
      </nav>
      <Outlet context={context} />
    </Screen>
  );
}
