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

/** Edit — a pencil, beside an editable name (Spec 10.3 section header). */
export function PencilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </Svg>
  );
}

/** A personal record — a trophy (Spec 17.0 AC7: brass via currentColor; the badge carries the label). */
export function TrophyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3h8v5a4 4 0 0 1-8 0V3z" />
      <path d="M8 5H5a3 3 0 0 0 3 4M16 5h3a3 3 0 0 1-3 4M12 12v4M8 21h8M9.5 17.5h5" />
    </Svg>
  );
}

/** On / done — a check mark (Spec 17.0: replaces a "✓" glyph the font does not have). */
export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Svg>
  );
}

