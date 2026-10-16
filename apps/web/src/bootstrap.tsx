import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyStoredTheme } from "./ui/theme";

// Global stylesheets (Spec 04.1 §6.2): tokens first so `reset.css` can read
// them. Imported here rather than in `AppRoot` so the config-error fallback
// page below is styled too. Vite emits them as one hashed external `.css`
// (CSP `style-src 'self'`, Spec 04.0 §6.6).
import "./ui/tokens.css";
import "./ui/fonts.css";
import "./ui/reset.css";

import { AppRoot } from "./app/AppRoot";
import { getConfig } from "./config";
import { Misconfigured } from "./screens/Misconfigured";

/**
 * The single boot seam (Spec 04.0 §6, AC2). `main.tsx` only locates `#root` and
 * calls this.
 *
 * Config is parsed before React mounts. On any config error we log the actionable
 * message and render a static, network-free "misconfigured" page; `#root` is
 * never left blank. The parsed config is consumed by the Auth0 provider in a
 * later step.
 */
export function bootstrap(rootElement: HTMLElement): void {
  // First, before the config parse and React: the stored Light / Dark choice, so nothing paints in the
  // wrong theme (Spec 17.0 §6.1, AC23). The CSP forbids the usual inline <head> script.
  applyStoredTheme();
  try {
    getConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `strength-in-numbers web app is misconfigured; not starting.\n${message}`,
    );
    createRoot(rootElement).render(<Misconfigured />);
    return;
  }

  createRoot(rootElement).render(
    <StrictMode>
      <AppRoot />
    </StrictMode>,
  );
}
