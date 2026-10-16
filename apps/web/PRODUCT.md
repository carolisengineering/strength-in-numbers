# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Lifters:** the owner and friends she invites, logging strength workouts from a phone, one-handed, between sets. The owner trains at a boutique gym with lots of natural light, lifts in pounds, and follows routines with planned sets, supersets and sections. On a desktop they plan routines and review history.
- **Portfolio reviewers:** people evaluating the app as the owner's portfolio work, for example for a job. They count equally with lifters (owner, 2026-10-16). First impressions and visible craft matter to them, but never at the cost of the lifter's workflow.

## Product Purpose

A fast, reliable way to record what you did in the gym and see whether you're progressing. The set-logging loop has to be faster and more pleasant than a notes app: target a median under 5 seconds to log a set (DESIGN §1.3). Success means workouts are logged during the session, not after, and people keep coming back.

## Positioning

- **Logging, nothing else.** No coaching, social feed, challenges or nutrition (DESIGN §1.5). The app does one job well.
- **Honest progress.** Personal records and charts are computed carefully: real PRs per exercise lineage, e1RM by Epley on integer milli-units, no streaks, badges or gamification.

## Operating Context

- **Phone in the gym:** glanced at between sets, often at arm's length, used with one thumb, sometimes on poor wifi. The thumb-zone bottom bars and 44px tap targets exist for this.
- **Desktop:** building and editing routines, reviewing history and progress charts.
- **Responsive web SPA only for v1.** Native apps are post-v1, and the API and domain layer stay ready for them.

## Capabilities and Constraints

- **Features:** an exercise catalog plus custom exercises; routines with planned sets, supersets, sections and notes; active-workout logging with an offline outbox and drafts; finished-workout history; personal records; progress charts; units (kg/lb); account data export and two-step deletion.
- **Design system constraints:**
  - `apps/web/src/ui/tokens.css` is the only place design values are written (CI checks this).
  - CSS Modules, with no CSS framework.
  - The CSP is strict (`script-src 'self'`; fonts must be self-hosted).
  - Icons are hand-written SVGs, always beside a text label.
- **Product decisions from the 2026-10-15 design review** (see the design refresh plan):
  - RPE is hidden everywhere in the UI. The data stays and the API still accepts it.
  - "Last time" previous performance is a future enhancement; it needs an API spec.
- **Process:** work is spec-driven (`docs/specs/`), and `docs/DESIGN.md` is the source of truth for product and architecture.

## Brand Commitments

- **Name:** "Strength in Numbers". There's no logo or mark (owner decision, 2026-10-15).
- **Voice:** plain and literal, in the lifter's own vocabulary ("3 × 5 @ 185 lb", "superset", "warm-up").
  - Controls name their action.
  - Errors say what happened and what to do.
  - American spelling.
  - Copy says "erase", never "purge", and never uses the word "dummy".

## Evidence on Hand

- There are no testimonials, user counts, reviews, press or benchmarks. Don't invent any.
- The only data is the owner's own training. Mockups and fixtures use clearly fake example data.

## Product Principles

1. **The next set comes first.** During a workout, what to do next is the most prominent thing on screen.
2. **Never lose a set.** Writes queue offline, drafts persist, and destructive actions confirm.
3. **Numbers are the content.** Weights, reps and records are shown precisely and legibly, rounded honestly.
4. **One job, done well.** New features earn their place against the logging loop; no engagement mechanics.
5. **Crafted enough to show.** Every screen should hold up to a reviewer's close look: aligned, consistent and accessible.

## Accessibility & Inclusion

WCAG 2.2 AA (owner decision, 2026-10-16):
- 4.5:1 text contrast in both light and dark mode
- visible focus, and focused content never hidden behind sticky bars (2.4.11)
- 44px tap targets
- screen-reader names that identify the exercise
- state never shown by color alone
