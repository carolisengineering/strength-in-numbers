import { z } from "zod";

/**
 * Spec 04.0 §7 — the SPA's CSP has no `unsafe-eval`. Zod v4 JIT-compiles object
 * parsers with `new Function`, after probing whether that's allowed; under our
 * CSP the probe fails (caught) but the browser reports a CSP violation each
 * time. `jitless` makes Zod skip both — it uses its interpreted parser, which is
 * what it fell back to under this CSP anyway.
 *
 * Must run before any schema is created: Zod reads the flag when a schema is
 * constructed, and `@sin/core` builds its DTO schemas at import time. So
 * `main.tsx` imports this module first (a test enforces it).
 */
z.config({ jitless: true });
