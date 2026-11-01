import { onlineManager, QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";

import type { HevyClient } from "../client/hevyClient";
import { HEVY_KEYS } from "../keys";
import { fetchHevyTemplates } from "./useHevyTemplates";

/** A Hevy client whose template read waits until the test answers it; after that, every read answers at once. */
function stubClient() {
  const page = { page: 1, page_count: 1, exercise_templates: [] };
  const answers: (() => void)[] = [];
  let open = false;
  const client = {
    listTemplates: () => (open ? Promise.resolve(page) : new Promise((resolve) => answers.push(() => resolve(page)))),
  } as unknown as HevyClient;
  const answerAll = () => {
    open = true;
    answers.splice(0).forEach((answer) => answer());
  };
  return { client, answerAll };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("Minor 272 — each template read owns only itself", () => {
  it("an overlapping call doesn't own the read; settling clears only the owner's own handle", async () => {
    const queryClient = new QueryClient();
    const { client, answerAll } = stubClient();
    const first = fetchHevyTemplates(queryClient, client);
    const second = fetchHevyTemplates(queryClient, client);
    expect([first.owned(), second.owned()]).toEqual([true, false]);
    answerAll();
    await Promise.all([first.promise, second.promise]);
    expect([first.owned(), second.owned()]).toEqual([false, false]);
  });

  it("a later call after the read settled answers from the cache and owns nothing past its own settling", async () => {
    const queryClient = new QueryClient();
    const { client, answerAll } = stubClient();
    const first = fetchHevyTemplates(queryClient, client);
    answerAll();
    await first.promise;
    const cached = fetchHevyTemplates(queryClient, client);
    await cached.promise;
    expect([first.owned(), cached.owned()]).toEqual([false, false]);
  });
});

describe("Minor 271 — a read paused offline counts as running", () => {
  it("a second call while the first is paused doesn't own it", async () => {
    onlineManager.setOnline(false);
    const queryClient = new QueryClient();
    queryClient.mount(); // a mounted client resumes paused reads when back online, as the app's provider does
    onTestFinished(() => queryClient.unmount());
    const { client, answerAll } = stubClient();
    const first = fetchHevyTemplates(queryClient, client);
    await tick();
    expect(queryClient.getQueryState(HEVY_KEYS.templates)?.fetchStatus).toBe("paused");
    const second = fetchHevyTemplates(queryClient, client);
    expect([first.owned(), second.owned()]).toEqual([true, false]);
    onlineManager.setOnline(true);
    await tick();
    answerAll();
    await Promise.all([first.promise, second.promise]);
  });
});
