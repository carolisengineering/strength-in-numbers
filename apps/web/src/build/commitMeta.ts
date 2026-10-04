import type { Plugin } from "vite";

/**
 * Spec 06.3 §6.3 / AC8 — stamps the deployed commit into `index.html` so the
 * post-deploy browser smoke can wait until Render serves *this* build. Render
 * sets `RENDER_GIT_COMMIT` at build time for static sites; locally it is unset
 * and the stamp is "dev", which never equals a SHA, so the CI wait fails loudly
 * instead of testing a stale build. Build-time only: imported by vite.config.ts,
 * never by the app.
 */
export const COMMIT_META_NAME = "sin-commit";

export function commitMeta(commit: string | undefined): Plugin {
  const value = commit === undefined || commit === "" ? "dev" : commit;
  if (value !== "dev" && !/^[0-9a-f]{7,40}$/i.test(value)) {
    throw new Error(`RENDER_GIT_COMMIT is not a hex commit hash: ${JSON.stringify(value)}`);
  }
  return {
    name: "sin-commit-meta",
    transformIndexHtml(html) {
      return html.replace(
        "</head>",
        `  <meta name="${COMMIT_META_NAME}" content="${value}" />\n  </head>`,
      );
    },
  };
}
