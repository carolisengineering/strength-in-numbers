/**
 * Spec 16 §6.2, §7 — load-test account *i* is `loadtest|NNN` (zero-padded), with an address at `example.test`, a
 * reserved domain no real person can have. Lifter *i* always uses account *i*; accounts are never shared.
 */
export function accountIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `loadtest|${String(i + 1).padStart(3, "0")}`);
}

export function accountEmail(id: string): string {
  return `loadtest+${id.split("|")[1]}@example.test`;
}
