/**
 * Spec 06.3 §8 — the suite's inputs. Read lazily so `playwright test --list`
 * and typecheck work without credentials; a test that needs a value fails
 * naming the variable.
 */
function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`e2e: missing env ${name} (see docs/runbooks/m1-browser-smoke.md)`);
  return value;
}

/** Playwright `storageState` — a live Auth0 session cookie; gitignored (§7). */
export const AUTH_STATE = "e2e/.auth/state.json";

export const E2E = {
  get baseUrl(): string {
    return need("E2E_BASE_URL").replace(/\/$/, "");
  },
  get apiUrl(): string | undefined {
    return process.env.E2E_API_URL?.replace(/\/$/, "") || undefined;
  },
  get username(): string {
    return need("E2E_AUTH0_USERNAME");
  },
  get password(): string {
    return need("E2E_AUTH0_PASSWORD");
  },
};
