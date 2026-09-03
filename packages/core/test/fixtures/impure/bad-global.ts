// Fixture for Spec 02 §2 AC2 — NOT part of the package. The purity check must
// flag the DOM global below. Never imported by src/.
export function readTheme(): string | null {
  return (globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage?.getItem(
    "theme",
  ) ?? null;
}
