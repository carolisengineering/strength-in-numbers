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
  server.use(
    ...(opts.owner === false
      ? []
      : [http.get(`${API_BASE_URL}/v1/hevy/status`, () => HttpResponse.json({ enabled: true, pairCount: 2, linkCount: link.rows.size, recordsStale: false }))]),
    http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json(opts.mapping ?? fixture.mapping)),
    ...hevyLinkHandlers(link),
    ...hevyApiHandlers(hevy, { hold: (op) => (op === "create" ? opts.holdCreate : undefined) }),
  );
  if (opts.key !== false) hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
  return { fake, link, hevy, detail };
}

export function cleanupSendScreen(): void {
  resetSendState(WORKOUT_ID);
  hevyKeyStore.remove(USER_ID);
  cleanupApp();
}

export { WORKOUT_ID };
