import { useLocation } from "react-router";

import { navItemFor } from "../app/navItems";
import { Screen } from "../ui/Screen";

/**
 * Stub for a nav section whose real screen ships in a later spec (Spec 04.1
 * §6.6). The nav item stays visible so the shell's information architecture is
 * stable; the body is one line.
 */
export function ComingSoon() {
  const { pathname } = useLocation();
  const title = navItemFor(pathname)?.label ?? "Coming soon";

  return (
    <Screen title={title}>
      <p data-testid="coming-soon">Coming with the next release.</p>
    </Screen>
  );
}
