import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain .mjs build script with no types
import { iconSvg, tokenColors } from "../../scripts/icons/icon.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC = join(WEB, "public");
const html = readFileSync(join(WEB, "index.html"), "utf8");
const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8")) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file: string): [number, number] {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const tokens = readFileSync(join(WEB, "src", "ui", "tokens.css"), "utf8");
const base = (name: string) => new RegExp(`:root\\s*\\{[^}]*--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(tokens)![1]!.toLowerCase();

describe("#97 — the app manifest", () => {
  it("names the app, labels the icon Strength, and opens full screen at the landing page", () => {
    expect(manifest).toMatchObject({
      name: "Strength in Numbers",
      short_name: "Strength",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
  });

  it("opens on the light ground (--color-bg)", () => {
    expect(manifest.background_color.toLowerCase()).toBe(base("color-bg"));
    expect(manifest.theme_color.toLowerCase()).toBe(base("color-bg"));
  });

  it("lists a 192, a 512 and a maskable 512 PNG, each the size it claims", () => {
    expect(manifest.icons.map((i) => [i.sizes, i.purpose ?? "any"])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      const [w, h] = pngSize(join(PUBLIC, icon.src));
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });
});

describe("#97 — index.html links the icons and full-screen mode", () => {
  it.each([
    ['<link rel="manifest" href="/manifest.webmanifest"', "manifest.webmanifest"],
    ['<link rel="icon" href="/icon.svg" type="image/svg+xml"', "icon.svg"],
    ['<link rel="apple-touch-icon" href="/apple-touch-icon.png"', "apple-touch-icon.png"],
  ])("%s, and the file exists", (tag, file) => {
    expect(html).toContain(tag);
    expect(existsSync(join(PUBLIC, file))).toBe(true);
  });

  it("asks iPhone for full screen under the label Strength", () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes"');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Strength"');
  });

  it("the apple-touch-icon is 180 px", () => {
    expect(pngSize(join(PUBLIC, "apple-touch-icon.png"))).toEqual([180, 180]);
  });
});

describe("#97 — the icon is option E in the token colors", () => {
  it("takes teal and cream from tokens.css", () => {
    expect(tokenColors()).toEqual({ ground: base("color-signal"), mark: base("color-bg") });
  });

  it("the committed favicon is what the script draws now (re-run `pnpm run icons` after a change)", () => {
    expect(readFileSync(join(PUBLIC, "icon.svg"), "utf8")).toBe(iconSvg({ rounded: true }));
  });
});
