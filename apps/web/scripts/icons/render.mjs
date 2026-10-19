// `pnpm --filter @sin/web run icons` (#97): write public/icon.svg and the PNGs the manifest and iPhone ask for,
// all from icon.mjs. Rasterized by Playwright's Chromium (already a dev dependency). Re-run after changing the
// drawing or the token colors, and commit the output; a unit test fails if icon.svg is stale.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { iconSvg } from "./icon.mjs";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

const PNGS = [
  { file: "apple-touch-icon.png", size: 180, safeZone: false },
  { file: "icon-192.png", size: 192, safeZone: false },
  { file: "icon-512.png", size: 512, safeZone: false },
  { file: "icon-maskable-512.png", size: 512, safeZone: true },
];

const browser = await chromium.launch();
try {
  for (const { file, size, safeZone } of PNGS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const svg = iconSvg({ safeZone }).replace("<svg ", `<svg width="${size}" height="${size}" `);
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.locator("svg").screenshot({ path: join(PUBLIC, file), omitBackground: false });
    await page.close();
    process.stdout.write(`icons: ${file} (${size} px)\n`);
  }
} finally {
  await browser.close();
}

// Last, so a failed run never leaves a new favicon beside old PNGs (the stale-check test reads only this file).
writeFileSync(join(PUBLIC, "icon.svg"), iconSvg({ rounded: true }));
