import { Screen } from "../ui/Screen";

/**
 * The `/app` index (Spec 04.1 §5). A short welcome until Spec 06 makes the
 * workout log the default landing section.
 */
export function AppIndex() {
  return (
    <Screen title="Welcome">
      <p data-testid="app-index">
        Log your lifts. See the numbers move. Logging lands in the next release;
        for now, set up your profile.
      </p>
    </Screen>
  );
}
