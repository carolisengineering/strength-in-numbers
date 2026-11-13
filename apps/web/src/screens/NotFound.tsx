import { TextLink } from "../ui/TextLink";

import { Screen } from "../ui/Screen";

/**
 * Catch-all screen (Spec 04.1 §5; deferred from 04.0). Mounted both inside the
 * shell (`/app/*`) and at the top level (`*`). The link targets `/app`;
 * `ProtectedRoute` bounces an unauthenticated user on to `/`.
 */
export function NotFound() {
  return (
    <Screen title="Page not found">
      <p data-testid="not-found">That page does not exist.</p>
      <TextLink to="/app">Go to the app</TextLink>
    </Screen>
  );
}
