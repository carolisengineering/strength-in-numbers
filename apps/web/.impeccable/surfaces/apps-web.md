---
version: 1
slug: "apps-web"
primary_target: "apps/web"
related_targets: []
---

# Surface brief: apps/web (the logged-in app)

**Scope and mode:** every logged-in screen of the web app (Workouts, History, Progress, Profile, the routine screens, sheets and dialogs). Mode: Operate. The landing page is a separate surface (Spec 17.3).

**Audience and job:** lifters log sets one-handed between sets, and plan and review on a desktop. Portfolio reviewers judge the craft. See PRODUCT.md.

**Constraints:**
- Only `tokens.css` holds design values.
- CSS Modules.
- The CSP requires self-hosted fonts.
- WCAG 2.2 AA in light and dark.
- Layout and behavior stay as Stage 1 left them; Stage 3 (Spec 17.1) changes the workout screen's structure.

**Chosen direction:** Stone. The owner picked it on 2026-10-15 from three mockups (Stone, Graphite, Olive-gray); see https://claude.ai/artifact/GWhVzq1b1DVGWQAeYGemiW.

## Direction contract

THESIS: A calm, precise instrument for the lift in front of you. Color is rationed by role: deep teal is the one interactive color (the primary action, where you are, what's selected, links, the superset bracket, the chart line), brass appears only when you beat a record, and red and orange only when something is wrong. It refuses the category default of a gray or black screen with a generic accent everywhere and record gold diluted by decoration. (Owner revised 2026-10-16: teal for the nav, links, chips and bracket.)

OWN-WORLD:
- **Ground and surfaces:** a warm stone ground (about #f3f1ec) with slightly lighter stone panels, set apart by tint rather than outlines, and warm ink text.
- **Color roles:** deep teal is the interactive color, and brass is for PRs. Warm-up sets are muted and marked W. Danger is a quiet brick.
- **Type:** Instrument Sans throughout, self-hosted, with tabular figures. Numbers get size and weight, not a second family.
- **Shape:** soft radii and hairline separators. Few boxes.
- **Dark mode:** a deliberate warm-charcoal version of the same roles.

STORY: The lifter glances and immediately sees what's next, logs it, and moves on. Their records feel earned because brass appears nowhere else. A reviewer sees a coherent, quiet system with no stray color.

FIRST VIEWPORT:
- **Active workout on a 390px phone:**
  - stone ground, a light header with the workout name, and exercise cards as tinted panels without outlines
  - logged sets as plain rows with tabular weight × reps; warm-ups muted with W
- **Bottom bar:** flush on the nav. Add exercise is quiet; Finish is the one teal fill.
- **Signature move:** numbers set as the content (large tabular weight × reps), with teal reserved for the next action.

FORM: Pinned by the owner from mockups (Stone over Graphite and Olive-gray); no concept-seed roll, per new-work's pinned-direction rule. Seed key: none (pinned).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
