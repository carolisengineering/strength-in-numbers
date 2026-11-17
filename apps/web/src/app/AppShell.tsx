import { useEffect, useRef, type MouseEvent } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

import { useMe } from "../features/me/useMe";
import { useIsDesktop } from "../ui/breakpoints";
import hidden from "../ui/VisuallyHidden.module.css";
import { trackKeyboardFrame } from "../ui/visualViewport";
import styles from "./AppShell.module.css";
import { NAV_ITEMS, navItemFor } from "./navItems";

const APP_NAME = "Strength in Numbers";

/** Spec 17.12 AC6: the first stop of the keyboard at desktop widths. */
export const SKIP_TO_CONTENT = "Skip to content";

/**
 * The four sections, from the `NAV_ITEMS` registry, for both the bottom nav and the rail (Spec 17.12): one list, two
 * looks. The current section is styled through the `aria-current="page"` attribute `NavLink` sets itself.
 */
function NavItems({ targetClass, labelClass }: { targetClass: string | undefined; labelClass: string | undefined }) {
  return NAV_ITEMS.map(({ to, label, icon: Icon, comingSoon }) => (
    <NavLink key={to} to={to} className={[targetClass, comingSoon ? styles.navTargetComingSoon : ""].filter(Boolean).join(" ")}>
      <Icon />
      <span className={labelClass}>{label}</span>
      {comingSoon ? (
        <span className={styles.navBadge} aria-label="coming soon">
          ·
        </span>
      ) : null}
    </NavLink>
  ));
}

/**
 * The protected frame (Spec 04.1 §5, AC2 / AC3). `ProtectedLayout` renders it
 * only on its `200 /v1/me` branch, so `useMe()` here is always resolved — it
 * shares `ME_QUERY_KEY`, so this is the same single request. The header shows
 * the current `displayName` (or `email` fallback) as a link to Profile; the
 * `<main>` holds the route `<Outlet/>`; the bottom `<nav>` is driven by the
 * `NAV_ITEMS` registry.
 *
 * Spec 17.12: at 64rem and wider (`useIsDesktop`) a side rail replaces the header and the bottom nav. The shell's
 * children are always four slots, `[skip link | null, rail | header, main, null | bottom nav]`, so `<main>` keeps its
 * place and the screen inside it survives a resize across 64rem (§6.1); only the rail, header and nav remount.
 */
export function AppShell() {
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const wide = useIsDesktop();
  const mainRef = useRef<HTMLElement>(null);
  const section = navItemFor(pathname);
  // `||`, not `??`: a stored "" (the API stores displayName verbatim) should
  // fall back to the email too.
  const userLabel = me?.displayName || me?.email || "";

  // While an on-screen keyboard is up the frame is the visible part of the screen (#206).
  useEffect(() => trackKeyboardFrame(), []);

  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    mainRef.current?.focus();
  };

  return (
    <div className={styles.shell} data-testid="app-shell" data-layout={wide ? "wide" : undefined}>
      {wide ? (
        <a className={`${hidden.hidden} ${styles.skipLink}`} href="#main" onClick={skipToContent}>
          {SKIP_TO_CONTENT}
        </a>
      ) : null}

      {wide ? (
        <nav className={styles.rail} aria-label="Primary">
          {/* Not a heading or a link: each screen owns the single <h1> (Screen.tsx). */}
          <p className={styles.railName}>{APP_NAME}</p>
          <NavItems targetClass={styles.railTarget} labelClass={styles.railLabel} />
          <Link className={styles.railUser} to="/app/profile" aria-label={`Profile: ${userLabel}`} data-testid="app-shell-user">
            <span className={styles.railUserName}>{userLabel}</span>
          </Link>
        </nav>
      ) : (
        <header className={styles.header}>
          {/* Not a heading: each screen owns the single <h1> (Screen.tsx). */}
          <p className={styles.headerTitle}>{section?.label ?? APP_NAME}</p>
          <Link
            className={styles.headerUser}
            to="/app/profile"
            aria-label={`Profile: ${userLabel}`}
            data-testid="app-shell-user"
          >
            <span className={styles.headerUserName}>{userLabel}</span>
          </Link>
        </header>
      )}

      {/* `id` and `tabIndex` only at desktop widths, where the skip link lands here; the phone's <main> is unchanged. */}
      <main className={styles.main} ref={mainRef} id={wide ? "main" : undefined} tabIndex={wide ? -1 : undefined}>
        <Outlet />
      </main>

      {wide ? null : (
        <nav className={styles.nav} aria-label="Primary">
          <NavItems targetClass={styles.navTarget} labelClass={styles.navLabel} />
        </nav>
      )}
    </div>
  );
}
