/**
 * Spec 16, minor 586 — the environment k6 runs with. k6 never prints its environment, but the tool keeps to "never
 * process.env": a still-exported `OWNER_DATABASE_URL` (the S0 run) or a stray `K6_*` setting must not reach it. Only
 * what k6 needs to start passes through from the shell; everything else is the tool's own variables.
 *
 * Minor 605: the proxy and CA variables pass too, so k6 works on a network that needs a proxy (without them `k6 version`
 * passes but every request fails, which reads as a 100% error rate). k6 is Go, and Go reads the lowercase proxy names
 * as well. Go reads `SSL_CERT_FILE` / `SSL_CERT_DIR` on Linux and the BSDs only; on macOS a custom CA must be in the
 * Keychain.
 */

/** The only shell variables k6 is given. */
export const K6_PASS_THROUGH = [
  "PATH",
  "HOME",
  "TMPDIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

/** The defined pass-through values from `processEnv`, then `own` on top. */
export function k6Env(processEnv: Record<string, string | undefined>, own: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of K6_PASS_THROUGH) {
    const value = processEnv[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...own };
}
