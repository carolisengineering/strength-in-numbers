import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

import { useMe } from "../features/me/useMe";
import { trackKeyboardFrame } from "../ui/visualViewport";
import styles from "./AppShell.module.css";
import { NAV_ITEMS, navItemFor } from "./navItems";

const APP_NAME = "Strength in Numbers";

/**
 * The protected frame (Spec 04.1 §5, AC2 / AC3). `ProtectedLayout` renders it
 * only on its `200 /v1/me` branch, so `useMe()` here is always resolved — it
 * shares `ME_QUERY_KEY`, so this is the same single request. The header shows
 * the current `displayName` (or `email` fallback) as a link to Profile; the
 * `<main>` holds the route `<Outlet/>`; the bottom `<nav>` is driven by the
 * `NAV_ITEMS` registry.
 */
export function AppShell() {
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const section = navItemFor(pathname);
  // `||`, not `??`: a stored "" (the API stores displayName verbatim) should
  // fall back to the email too.
  const userLabel = me?.displayName || me?.email || "";

  // While an on-screen keyboard is up the frame is the visible part of the screen (#206).
  useEffect(() => trackKeyboardFrame(), []);

  return (
    <div className={styles.shell} data-testid="app-shell">
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

      <main className={styles.main}>
        <Outlet />
      </main>

      <nav className={styles.nav} aria-label="Primary">
        {NAV_ITEMS.map(({ to, label, icon: Icon, comingSoon }) => (
          <NavLink
            key={to}
            to={to}
            // The current section is styled via the `aria-current="page"`
            // attribute NavLink sets itself (see AppShell.module.css).
            className={[
              styles.navTarget,
              comingSoon ? styles.navTargetComingSoon : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <Icon />
            <span className={styles.navLabel}>{label}</span>
            {comingSoon ? (
              <span className={styles.navBadge} aria-label="coming soon">
                ·
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
