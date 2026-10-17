---
name: Strength in Numbers (web app)
description: The visual system of the logged-in web app, "Stone". A calm, precise instrument for the lift in front of you.
colors:
  bg: "#f3f1ec"
  surface: "#fbfaf7"
  surface-raised: "#ffffff"
  text: "#24211d"
  muted: "#6b645b"
  border: "#8c857a"
  line: "#e3ded5"
  signal: "#1f5f5b"
  on-signal: "#ffffff"
  signal-soft: "#e1ebe8"
  pr: "#84651c"
  pr-soft: "#f3ead2"
  danger: "#a3392b"
  success: "#2d6a3e"
  warning: "#9c4a0c"
  focus: "#1f5f5b"
typography:
  display:
    fontFamily: "Instrument Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    fontFeature: "tnum"
  headline:
    fontFamily: "Instrument Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
    fontFeature: "tnum"
  figure:
    fontFamily: "Instrument Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.1
    fontFeature: "tnum"
    fontVariation: "'wdth' 90"
  set:
    fontFamily: "Instrument Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.5
    fontFeature: "tnum"
  body:
    fontFamily: "Instrument Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Instrument Sans, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "10px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "6": "1.5rem"
  "8": "2rem"
  screen-pad: "1rem"
  card-pad-block: "0.75rem"
  card-pad-inline: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "44px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "44px"
  button-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.75rem"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1rem"
  records-panel:
    backgroundColor: "{colors.pr-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1rem"
  nav-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "44px"
  nav-item-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.signal}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.md}"
    height: "44px"
  dialog:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "1rem"
---

# Design System: Strength in Numbers (web app)

> This file describes the **visual system of the web app** (`apps/web`) only: palette, type, surfaces, shapes and components.
> **`docs/DESIGN.md` remains the product and architecture source of truth**; it points here through its Q22 entry.
> The decisions recorded here were made in **Spec 17.0** (`docs/specs/17.0-visual-identity-stone.md`, the "Stone" identity). Later specs (17.1–17.3) extend it in the same change that adds a use.
>
> Normative values: the frontmatter above holds the light theme. `src/ui/tokens.css` is the only place design values are written, and it wins over this file if they ever disagree. The extension metadata (dark values, motion, breakpoint, component snippets) is in `.impeccable/design.json`.

## Overview

**Creative North Star: "The Calm Instrument"**

A precise, quiet tool for the lift in front of you. The lifter glances at a phone at arm's length between sets, sees what comes next, logs it and moves on. The screen is a warm stone ground with slightly lighter stone panels and warm ink. Color is rationed by role, so whatever color appears means something: deep teal is the one interactive color, brass appears only when you beat a record, and brick or burnt orange only when something is wrong. On most screens teal is the only chromatic color.

Numbers are the content. Weights, reps and readouts get size and weight from the one typeface, never a second family, and every digit is tabular so columns line up and nothing jitters. Panels are set apart by tint, not outline; there are few boxes, soft radii, and hairlines only where a structural edge needs one. There are no shadows.

The system is light-first, designed for a gym with natural light. Dark is a deliberate warm-charcoal version of the same roles: it follows the OS through `prefers-color-scheme`, or the Profile switch forces Light or Dark through `data-theme` on `<html>`. It refuses the category default of a gray or black screen with a generic accent everywhere and record gold diluted by decoration.

**Key Characteristics:**
- Warm stone ground and panels, warm ink; light is the base theme, dark is the same roles in warm charcoal.
- One interactive color (teal); brass for records only; brick and burnt orange only for trouble.
- Instrument Sans everywhere, self-hosted, tabular figures on by default.
- Figures as the signature: larger, firmer, slightly narrower numbers.
- Separation by tint, not outline; no shadows; dialogs have no frame.
- Hand-drawn 2px-stroke icons, always beside a text label.
- Thumb-zone layout: 44px targets, a sticky bottom ActionBar flush on the bottom nav.

## Colors

A warm-neutral stone palette with one teal voice, one brass reward, and two trouble colors, each meaning exactly one thing.

Each color is defined twice: light in `:root` (the frontmatter values) and dark in two blocks (`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and `:root[data-theme="dark"]`). CSS cannot share a declaration list between a media query and a selector, so the dark values are written twice. `tokens.contrast.test.ts` (AC20) fails if the two dark blocks ever differ. `:root[data-theme="light"]` sets only `color-scheme: light`, so native widgets stay light on a dark OS. Color values are opaque hex only, so the contrast test computes exact ratios.

### Primary
- **Deep Stone Teal** (`signal`; dark `#6fbab1`): the interactive color. It marks the primary action (the `Button` primary fill: Finish, Start, Save), where you are (the active nav item), links, what is chosen (selection), the chart line and dots, and the superset bracket. Text on it is **On-Signal** (`on-signal`; dark `#0f2321`). **Teal Wash** (`signal-soft`; dark `#1f3431`) is a tinted signal ground, also used for `::selection`.
- **Focus Teal** (`focus`; dark `#6fbab1`): the focus ring. Same value as signal, but its own token. It may appear in any stylesheet, only as an `outline`.
- **Selected / On-Selected** (`--color-selected`, `--color-on-selected`): aliases of signal and on-signal for the fill and text of a chosen option (chips, segments, the theme switch). They are separate names so selection can diverge later without a sweep.

### Secondary
- **Record Brass** (`pr`; dark `#d8b566`): records, and nothing else. The heading of the records block and the History trophy badge. **Brass Wash** (`pr-soft`; dark `#3a3120`) is the records panel's ground. The record lines themselves stay ink.

### Tertiary (state)
- **Quiet Brick** (`danger`; dark `#e58b7a`): destructive *and* failed. Delete, discard, a write that did not save ("Couldn't save"), field errors, the error notice. It does not mean "important".
- **Burnt Orange** (`warning`; dark `#e39a5b`): needs attention ("Needs data", warning notices). It is deliberately off brass so a warning never reads as a record.
- **Field Green** (`success`; dark `#86c493`): the "Saved" confirmation (one use).

### Neutral
- **Stone Ground** (`bg`; dark `#1c1a17`): the ground behind everything; also the sheet and the ActionBar background, and the `theme-color` of each theme.
- **Stone Panel** (`surface`; dark `#26231f`): cards, list rows, the app header and the bottom nav. Its contrast with the ground (about 1.1:1) is decorative and exempt by design.
- **Raised Stone** (`surface-raised`; dark `#2f2b26`): dialogs, secondary buttons, segmented options.
- **Warm Ink** (`text`; dark `#eeeae3`): body text, headings, the spinner.
- **Warm Gray** (`muted`; dark `#a8a196`): secondary text, labels, inactive nav, set numbers. **Warm-up** (`--color-warmup`) is an alias of muted, used only on warm-up set rows.
- **Control Boundary** (`border`; dark `#7d776c`): the 1px boundary of a control (inputs, selects, secondary and disabled buttons, the segmented strip). At least 3:1 against ground and panel (WCAG 1.4.11).
- **Hairline** (`line`; dark `#37332e`): decorative separators only (header and nav edges, the ActionBar top, a sheet header, the entry row, chart gridlines). About 1.2–1.4:1; nothing depends on seeing it.

### Named Rules
**The Single Meaning Rule.** Each color role means one thing. Teal is interactive, brass is a record, muted plus W is a warm-up, brick is destructive or failed, burnt orange needs attention. `roles.test.ts` keeps brass, warm-up and signal inside per-file allow-lists; a new use edits the list in the same change and justifies it in its spec.

**The Earned Brass Rule.** Brass appears only where a personal record is shown. It is never used for selection, links, charts or decoration.

**The Never By Color Alone Rule.** Every color state has a second cue: the active nav item is bold plus `aria-current`, a selection is a fill plus checked or `aria-pressed`, links are underlined, a warm-up set carries a W and "Warm-up" in its name, notices and tags carry words.

**The Two Borders Rule.** `border` is a control's 3:1 boundary; `line` is a decorative hairline. Never use `line` to outline a control, and never use `border` to outline a panel.

## Typography

**Display Font:** Instrument Sans (with system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif)
**Body Font:** Instrument Sans (same stack)

**Character:** One grotesque, used throughout. It is self-hosted as a single latin-subset roman variable woff2 (weight 400–700, width 75–100%), declared in `fonts.css` with `font-display: swap` and preloaded from `index.html`, so the strict CSP's `font-src 'self'` covers it. Hierarchy comes from size and weight; numbers come from the same family with more weight and a narrower width.

### Hierarchy
- **Display** (700, 1.75rem, 1.2): the screen title, one per screen.
- **Headline** (700, 1.25rem, 1.2): the app header's title, exercise card names, sheet and dialog titles, the records block heading.
- **Figure** (`--font-weight-figure`, `--font-size-figure`, `--font-stretch-figure`; line-height 1.1): a screen's key number, such as the selected point's value on an exercise's progress screen.
- **Set** (`--font-weight-figure`, `--font-size-set`): a logged set row's weight × reps. A warm-up row drops to body size at weight 400 in Warm Gray, with a bold W.
- **Body** (400, 1rem, 1.5): running text, notes, list content; screens cap at a 40rem measure.
- **Label** (600, 0.875rem): field labels, legends, tags, nav labels, hints (hints are 400).

### Named Rules
**The Figures Are The Content Rule.** Numbers get size, weight and a narrower width from the four figure tokens (`--font-size-figure`, `--font-size-set`, `--font-weight-figure`, `--font-stretch-figure`), never a second family. They are the system's signature.

**The Tabular Everywhere Rule.** `body` sets `font-variant-numeric: tabular-nums` once, and everything inherits it, chart labels included. No stylesheet sets it back to proportional, and no per-component number class exists.

## Layout

Mobile-first and single column. A screen is a flex column with a 1rem (`--space-4`) gap, padded by `--screen-pad` (1rem), capped at `--measure-max` (40rem) and centered; wide screens only cap the measure. The app shell is a three-row grid fixed to the viewport height: a slim header (Stone Panel), a scrolling main, and a bottom nav (Stone Panel) at every width. At 48rem and above, the header's inline padding grows to 2rem and the main column caps at the measure.

The spacing scale is `--space-1` through `--space-8` (0.25, 0.5, 0.75, 1, 1.5, 2rem). Rows inside a panel are separated by gaps (0.5rem between set rows), not by borders. Every card-like panel uses the card insets (`--card-pad-block` 0.75rem, `--card-pad-inline` 1rem), so their edges line up.

**The ActionBar** holds a screen's thumb-zone actions (Add exercise / Finish, Cancel / Save, Start). It is sticky at the bottom of the scrolling main, flush on the nav, on the Stone Ground with a Hairline above. It bleeds across exactly `--screen-pad` on each side, its buttons share the width equally, and an optional muted status line sits under them. A screen with an ActionBar drops its own bottom padding, and the scroller keeps `--action-bar-clearance` of scroll padding so focused content never hides behind the bar (WCAG 2.4.11).

**The Thumb Rule.** Every interactive target is at least `--tap-target-min` (44px) in both axes. Sizes are rem so they follow the user's font setting; radii, the tap target and the 1px lines are the physical exceptions.

## Elevation & Depth

Flat. The system has no shadows. Depth is tonal: Stone Ground at the back, Stone Panel for cards and rows, Raised Stone for dialogs and secondary buttons. A confirm dialog lifts by its raised surface over a 70% Stone Ground backdrop, with no frame and no shadow. A full sheet is the Stone Ground itself, covering the screen, with a Hairline under its header.

### Named Rules
**The Tint Not Outline Rule.** Panels (exercise cards, routine notes, History rows, records, notices, progress rows) separate from the ground by tint alone. A panel gets a 1px outline only to carry state: a warning or error notice in its tone color, a "Needs data" set row in Burnt Orange. Controls keep their Control Boundary.

**The No Frame Rule.** Dialogs and sheets have no border and no shadow; the browser's default dialog frame is removed.

## Shapes

Soft, small radii and straight hairlines. Two radii: `sm` (6px) for inputs, set rows, nav targets and the bracket's ends; `md` (10px) for buttons, cards, panels, notices, dialogs and the segmented strip. Circles only for the spinner ring and chart dots. The superset bracket is a 0.25rem teal bar down the left of each member row, continuous across the run, rounded only at its ends.

Icons are drawn, not typed: inline 24×24 SVGs, `currentColor`, 2px stroke with round caps and joins, no fill, sized at 1.5rem, `aria-hidden`. Every icon sits beside a text label, so the UI works with none of them. There is no icon package and no emoji or Unicode glyph standing in for an icon (the trophy, check and close marks are all drawn).

## Components

### Buttons
Quiet, firm and thumb-sized.
- **Shape:** gently rounded (10px), at least 44px in both axes, 600 weight, 1rem.
- **Primary:** a Deep Stone Teal fill with On-Signal text. Ideally one per screen: the next action.
- **Secondary:** Raised Stone with Warm Ink text and a 1px Control Boundary.
- **Danger:** transparent with Quiet Brick text and a 1px brick outline; it never fills.
- **Disabled:** reads as "not now", not broken: transparent, Warm Gray text, Control Boundary outline, in every variant. A busy button (`aria-busy`) keeps its variant's look.
- **Hover / Focus:** background and color ease over 120ms. Focus is the global 2px Focus Teal outline at a 2px offset.

### Chips and segmented controls
- **Style:** unselected options look like secondary buttons (Raised Stone, Control Boundary).
- **State:** selected fills with `--color-selected` and `--color-on-selected` text, together with `aria-pressed` or a checked radio. The Light / Dark / System theme switch is a segmented strip: three equal options inside one bordered 10px strip, divided by Control Boundary lines, with native radios kept in the accessibility tree.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** Stone Panel on Stone Ground.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** none, except a tone outline that carries state.
- **Internal Padding:** `--card-pad-block` by `--card-pad-inline` (0.75rem by 1rem).

### Inputs / Fields
- **Style:** Stone Panel fill, 1px Control Boundary, 6px radius, at least 44px tall, 0.5rem by 0.75rem padding. A Label-style muted label sits above with a 0.25rem gap; hints are muted 0.875rem.
- **Focus:** the global Focus Teal outline; the caret and native accents are teal too.
- **Error:** the boundary turns Quiet Brick (`aria-invalid`) and a brick 0.875rem message follows.

### Navigation
- **Style:** a bottom bar of equal columns on Stone Panel with a Hairline on top, clearing the iOS home indicator. Each target is an icon over a Label (0.875rem), at least 44px.
- **States:** inactive is Warm Gray; the current page is Deep Stone Teal and 700 weight with `aria-current="page"`. Labels ellipsize rather than widen the page.

### Logged set row (signature)
A logged set is a full-width, borderless, 44px button inside its card: a muted set number, then weight × reps in the Set figure style. A warm-up row is Warm Gray, body size and weight 400, with a bold W in a fixed slot after the set number (`aria-hidden`), and its accessible name still says "Warm-up". `data-set-type` is on every row so later specs can target types without a class per type. The finished-workout screen marks warm-ups the same way.

### Current-set panel (entry panel)
The current exercise's next set, on a Signal Wash (`--color-signal-soft`) ground at 10px with card insets and no outline: a bold teal label row ("Set 3 of 4", "Set 1 of 5 · Warm-up"), the steppers, and a secondary "Set options" disclosure holding Set type and the units. `data-set-type` is on the panel. It is the one place outside the shared Button that uses teal on the workout screen (allow-listed in `roles.test.ts`, `features/workouts/EntryRow.module.css`, with `RestLine.module.css` for the rest line, Spec 17.1 D12). Its labels are muted and its errors brick; both pass 4.5:1 on the wash. Controls keep their own Stone Panel / Raised Stone fill, against which the Control Boundary holds 3:1 (against the wash itself it is about 3.0:1 light and 2.97:1 dark, an open question for the owner).

### Stepper
− number + for weight and reps: two 3rem secondary buttons with drawn minus and plus icons around a text input set in the figure style (`--font-size-figure`, `--font-weight-figure`, `--font-stretch-figure`), its unit muted under it. A button at its limit is disabled, never hidden. Each control is a labeled group ("Weight · lb"). Duration and distance keep fields at the same figure size. On a phone weight and reps stack (each stepper needs `--stepper-min-width`); they share a row only where both fit.

### Collapsed exercise row
A non-current exercise is one 44px line inside its card: the summary ("Bench Press · 2 of 4 · next 185 × 5") as the heading's button, a drawn muted check when every planned set is logged, and the "Not saved yet" / "Couldn't save" words when a write is pending or failed.

### Workout menu
One secondary "Workout menu" button in the top row beside the elapsed clock reveals End workout early (or Finish workout) and Discard workout inline, full width. No popover.

### Rest line and readout
A 3px line (`--rest-line-height`) across the top of the workout screen: a `--color-line` track with a `--color-signal` fill, sticky at the top of the scroller and bleeding across the screen padding. It fills once a second as the rest runs and is gone at zero. Its slot is always mounted, so a rest starting or ending never moves the page. It is a native `<progress>` inside an `aria-hidden` slot, because the production CSP forbids inline style; "Rest over" is said once, politely, outside the hidden slot. The readout is "Rest m:ss", then "Ready" at zero, a figure in the panel's label row, not teal (the panel's label is the teal element). `RestLine.module.css` is on the signal allow-list in `roles.test.ts`. No sound, vibration or notification (Spec 17.1 D10).

### Finish stats
A `ul` of figures over small muted labels: "52 min / duration", "4 / exercises", "18 / sets", and "14,250 lb / volume" when a working set qualifies. Figures use the figure tokens (tabular); the row wraps (2 x 2 at 390 px) and never clips a long figure. Shared by both Finish dialogs (three stats, no volume) and the summary header (four). It is static: no animation, no live region, nothing announced on arrival (Spec 17.2 AC13). "sets" counts working sets only.

### Record cards
Under a bold Record Brass heading ("Personal records" and "N new"), one Brass Wash card per exercise (10px, card insets, a tint and no outline): the exercise name and the lead set ("82.5 kg x 5"), the lead label, the new value large in ink, the gain in bold brass ("+2.5 kg") or "First record", a muted "was 80 kg", then the exercise's other records as name-only chips on a neutral surface tint. Set-volume records are not shown. On light, brass on its wash is the thinnest contrast in the system (about 4.5:1), so brass text stays bold and large. Progress keeps the plain records list. `RecordCardList.module.css` is on the brass allow-list. In History, a record is a brass drawn trophy plus "N PRs" beside the row (the accessible name stays "N personal records"); a workout with no records shows nothing there.

### Notices
`InlineNotice` is a Stone Panel block (10px, 0.75rem by 1rem). Info has no outline; warning and error add a 1px Burnt Orange or Quiet Brick outline, and the words carry the meaning. There is no colored side stripe.

## Do's and Don'ts

### Do:
- **Do** write every design value in `src/ui/tokens.css` and read it through `var(--…)`. `assert:css-tokens` fails CI on a hex color or px length anywhere else (except `0` and `1px`).
- **Do** give every new color token a contrast pair, or a commented exemption, in `tokens.contrast.test.ts`; text pairs need 4.5:1 and control boundaries, focus and teal strokes need 3:1, in both themes.
- **Do** write a new dark value into both dark blocks; the test fails if they differ.
- **Do** add a file to the signal, brass or warm-up allow-list in `roles.test.ts` in the same change that adds the use, and justify it in that spec.
- **Do** separate panels with Stone Panel on Stone Ground, and keep the 1px Control Boundary on every control.
- **Do** set key numbers with the figure tokens (`--font-size-figure`, `--font-size-set`, `--font-weight-figure`, `--font-stretch-figure`).
- **Do** pair every color state with a non-color cue (weight, `aria-current`, checked, underline, a W, words).
- **Do** draw new icons in `ui/icons.tsx` as 24×24, 2px-stroke, `currentColor` SVGs, and put a text label beside each.
- **Do** keep targets at 44px and place a screen's main actions in the ActionBar.
- **Do** keep one primary Button per screen. On the workout screen it is the bottom bar's Log / Finish button; everything else there is secondary or danger.

### Don't:
- **Don't** use brass for anything that is not a personal record.
- **Don't** give warm-up sets a color of their own; they are muted and marked W.
- **Don't** use teal for decoration, records, warnings or failures.
- **Don't** outline a panel with `--color-border`, or outline a control with `--color-line`.
- **Don't** add shadows, or a frame to a dialog.
- **Don't** add a second typeface, a third-party font request, or a `data:` font.
- **Don't** switch figures back to proportional digits anywhere.
- **Don't** use an emoji or Unicode glyph as an icon, and don't add an icon package.
- **Don't** reintroduce a catch-all accent token; `--color-accent` was removed on purpose.
