import type { ComponentType } from "react";

import {
  ChartIcon,
  ClockIcon,
  DumbbellIcon,
  PersonIcon,
  type IconProps,
} from "../ui/icons";

export interface NavItem {
  /** Absolute route path under the shell. */
  readonly to: string;
  readonly label: string;
  readonly icon: ComponentType<IconProps>;
  /** The section's real screen ships in a later spec; renders `ComingSoon`. */
  readonly comingSoon?: true;
}

/**
 * The bottom-nav registry (Spec 04.1 §3 / §5 / §6.6). Order is display order.
 * Later UI specs flip their `comingSoon` off and add the child route + screen;
 * the shell's information architecture never changes shape.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/app/workouts", label: "Workouts", icon: DumbbellIcon, comingSoon: true },
  { to: "/app/history", label: "History", icon: ClockIcon, comingSoon: true },
  { to: "/app/progress", label: "Progress", icon: ChartIcon, comingSoon: true },
  { to: "/app/profile", label: "Profile", icon: PersonIcon },
];

/** The nav item whose section contains `pathname`, if any. */
export function navItemFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
}
