import type { Api, ApiResponse } from "../src/node/api.ts";

/** An in-memory stand-in for one account's API: workouts (one may be live), routines, the catalog, and a call log. */
export class FakeApi implements Api {
  calls: string[] = [];
  workouts: { id: string; live: boolean }[] = [];
  routines: { id: string; name: string }[] = [];
  catalog = [
    "barbell-back-squat",
    "barbell-bench-press",
    "conventional-deadlift",
    "overhead-press",
    "barbell-row",
    "pull-up",
  ].map((catalogKey, i) => ({ id: `0190f6c2-0000-7000-8000-${String(i).padStart(12, "0")}`, catalogKey }));
  /** Ids whose next DELETE answers 404 (someone else removed it first). */
  goneOnDelete = new Set<string>();
  pageSize = 2;
  private nextId = 1;

  async get(path: string): Promise<ApiResponse> {
    this.calls.push(`GET ${path}`);
    if (path === "/v1/workouts/active") {
      const live = this.workouts.find((w) => w.live);
      return live ? { status: 200, body: { id: live.id } } : { status: 404, body: {} };
    }
    if (path.startsWith("/v1/workouts?")) {
      const url = new URL(path, "http://x");
      const start = Number(url.searchParams.get("cursor") ?? "0");
      const finished = this.workouts.filter((w) => !w.live);
      const items = finished.slice(start, start + this.pageSize).map((w) => ({ id: w.id }));
      const next = start + this.pageSize < finished.length ? String(start + this.pageSize) : null;
      return { status: 200, body: { items, next } };
    }
    if (path === "/v1/routines") return { status: 200, body: { routines: this.routines } };
    if (path === "/v1/exercises") return { status: 200, body: { exercises: this.catalog, syncToken: "1.1" } };
    return { status: 404, body: {} };
  }

  async post(path: string, body: unknown): Promise<ApiResponse> {
    this.calls.push(`POST ${path}`);
    if (path === "/v1/routines") {
      const id = `0190f6c2-2222-7000-8000-${String(this.nextId++).padStart(12, "0")}`;
      this.routines.push({ id, name: (body as { name: string }).name });
      return { status: 201, body: { id, name: (body as { name: string }).name } };
    }
    return { status: 404, body: {} };
  }

  async patch(path: string): Promise<ApiResponse> {
    this.calls.push(`PATCH ${path}`);
    return { status: 404, body: {} };
  }

  async del(path: string): Promise<{ status: number }> {
    this.calls.push(`DELETE ${path}`);
    const id = path.split("/").pop()!;
    if (this.goneOnDelete.delete(id)) {
      this.workouts = this.workouts.filter((w) => w.id !== id);
      return { status: 404 };
    }
    const before = this.workouts.length;
    this.workouts = this.workouts.filter((w) => w.id !== id);
    return { status: this.workouts.length < before ? 204 : 404 };
  }
}
