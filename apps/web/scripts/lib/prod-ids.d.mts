// Types for prod-ids.mjs (imported by the API's scripts and tests).
export function parseTfvars(text: string): Record<string, string>;
export function prodOrigins(tfvarsText: string): { apiOrigin: string; webOrigin: string };
export function placeholderIds(tfvarsText: string): string[];
