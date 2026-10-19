// The Home Screen icon (#97, option E): a solid cream dumbbell on a slant, on teal. One drawing; every PNG and
// the favicon come from it via `render.mjs`. Colors are read from tokens.css, the only place they are written.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOKENS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "ui", "tokens.css");

/** Teal (`--color-signal`) ground and cream (`--color-bg`) mark, from the light `:root` block. */
export function tokenColors() {
  const css = readFileSync(TOKENS, "utf8");
  const read = (name) => new RegExp(`:root\\s*\\{[^}]*--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)[1].toLowerCase();
  return { ground: read("color-signal"), mark: read("color-bg") };
}

/**
 * The icon as SVG on a 100-unit square.
 * - `rounded`: a rounded square (the favicon); otherwise full bleed, as the platforms round or mask it themselves.
 * - `safeZone`: shrink the dumbbell to 80% so Android's masks (circle, squircle) never cut a plate.
 */
export function iconSvg({ rounded = false, safeZone = false } = {}) {
  const { ground, mark } = tokenColors();
  const scale = safeZone ? " translate(50 50) scale(0.8) translate(-50 -50)" : "";
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    `<rect width="100" height="100"${rounded ? ' rx="22"' : ""} fill="${ground}"/>`,
    `<g fill="${mark}" transform="rotate(-45 50 50)${scale}">`,
    '<rect x="30" y="46" width="40" height="8" rx="2"/>',
    '<rect x="22" y="27" width="11" height="46" rx="4"/>',
    '<rect x="67" y="27" width="11" height="46" rx="4"/>',
    '<rect x="11" y="35" width="9" height="30" rx="3.5"/>',
    '<rect x="80" y="35" width="9" height="30" rx="3.5"/>',
    "</g>",
    "</svg>",
    "",
  ].join("\n");
}
