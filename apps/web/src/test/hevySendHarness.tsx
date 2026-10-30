import { http, HttpResponse } from "msw";
import type { HevyMapping, WorkoutDetail } from "@sin/core";

import { hevyKeyStore } from "../features/hevy/keyStore";
import { resetSendState, setSendSleepForTests } from "../features/hevy/send/useSendToHevy";
import { API_BASE_URL } from "./accountHarness";
import { setInstantPacing, USER_ID, VALID_KEY } from "./hevyHarness";
import { fakeHevyLink, fakeHevyWrites, hevyApiHandlers, hevyLinkHandlers, sendFixture, WORKOUT_ID } from "./hevySendFakes";
import { server } from "./msw/server";
import { createWorkoutFake } from "./workoutFake";
import { cleanupApp, prepareApp } from "./workoutHarness";

/**
 * Test-only (Spec 20.2): the real app with one finished workout (`WORKOUT_ID`), the owner's `200` status, the mapping,
 * the fake link server (fingerprints read from the workout fake, so an edit there flips `sent` → `changed`) and the
 * fake Hevy. The key is stored after `prepareApp` (which clears `sin:hevy:`) unless `key: false`.
 */
export function setupSendScreen(
  auth: Parameters<typeof prepareApp>[0]["auth"],
  opts: { detail?: WorkoutDetail; mapping?: HevyMapping; key?: boolean; owner?: boolean; holdCreate?: Promise<void> } = {},
) {
  const fixture = sendFixture();
  const detail = opts.detail ?? fixture.detail;
  const fake = createWorkoutFake({ finished: [detail] });
  prepareApp({ auth, fake });
  const link = fakeHevyLink({ detailOf: (id) => fake.state.finished.get(id) ?? null });
  const hevy = fakeHevyWrites();
  setInstantPacing();
  setSendSleepForTests(async () => {});
  // The mapping as the server holds it: a PATCH upserts (by Hevy template id) and the next read sees it.
  let mapping: HevyMapping = opts.mapping ?? fixture.mapping;
  const patches: unknown[] = [];
  const patchFailures: number[] = [];
  server.use(
    ...(opts.owner === false
      ? []
      : [http.get(`${API_BASE_URL}/v1/hevy/status`, () => HttpResponse.json({ enabled: true, pairCount: 2, linkCount: link.rows.size, recordsStale: false }))]),
    http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json(mapping)),
    http.patch(`${API_BASE_URL}/v1/hevy/mapping`, async ({ request }) => {
      const body = (await request.json()) as { upsert?: HevyMapping["pairs"] };
      patches.push(body);
      const status = patchFailures.shift();
      if (status !== undefined) {
        return new HttpResponse(JSON.stringify({ type: "https://api.strengthinnumbers.app/problems/rate-limited", title: "Too many", status }), {
          status,
          headers: { "content-type": "application/problem+json", "retry-after": "30" },
        });
      }
      const upserts = (body.upsert ?? []).map((p) => ({ ...p, exerciseActive: true }));
      const ids = new Set(upserts.map((p) => p.hevyTemplateId));
      mapping = { ...mapping, pairs: [...mapping.pairs.filter((p) => !ids.has(p.hevyTemplateId)), ...upserts] };
      return HttpResponse.json(mapping);
    }),
    ...hevyLinkHandlers(link),
    ...hevyApiHandlers(hevy, { hold: (op) => (op === "create" ? opts.holdCreate : undefined) }),
  );
  if (opts.key !== false) hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  return { fake, link, hevy, detail, patches, failPatch: (status: number) => void patchFailures.push(status) };
}

export function cleanupSendScreen(): void {
  resetSendState(WORKOUT_ID);
  hevyKeyStore.remove(USER_ID);
  cleanupApp();
}

export { WORKOUT_ID };
