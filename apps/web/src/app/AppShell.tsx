import { Link, NavLink, Outlet, useLocation } from "react-router";

import { useMe } from "../features/me/useMe";
import styles from "./AppShell.module.css";
import { NAV_ITEMS, navItemFor } from "./navItems";

const APP_NAME = "strength-in-numbers";

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
  const userLabel = me?.displayName ?? me?.email ?? "";

  return (
    <div className={styles.shell} data-testid="app-shell">
      <header className={styles.header}>
        <h2 className={styles.headerTitle}>{section?.label ?? APP_NAME}</h2>
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
            className={({ isActive }) =>
              [
                styles.navTarget,
                comingSoon ? styles.navTargetComingSoon : "",
                isActive ? "active" : "",
              ]
                .filter(Boolean)
                .join(" ")
            }
          >
            <Icon />
            <span>{label}</span>
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
