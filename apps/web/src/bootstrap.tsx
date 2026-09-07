import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

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
