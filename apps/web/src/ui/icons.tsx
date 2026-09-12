import type { ReactNode, SVGProps } from "react";

import styles from "./icons.module.css";

/**
 * Inline SVG icons (Spec 04.1 §5, Q25). Hand-written, `currentColor`, sized
 * by a token, and `aria-hidden` — every use site renders a text label beside
 * the icon, so these are decorative and the UI works with none of them.
 * No icon package (§12 Q25).
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Svg({ className, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={[styles.icon, className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

/** Workouts — a dumbbell. */
export function DumbbellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" />
    </Svg>
  );
}

/** History — a clock. */
export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

/** Progress — a rising line chart. */
export function ChartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 19h16M4 15l5-5 4 4 7-8" />
    </Svg>
  );
}

/** Profile — a person. */
export function PersonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </Svg>
  );
}
