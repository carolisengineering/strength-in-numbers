import type { HevyTemplate } from "@sin/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { stubAccountEnv, unstubAccountEnv } from "../../../test/accountHarness";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { renderHevyScreen } from "../../../test/hevyHarness";
import { server } from "../../../test/msw/server";
import { useCatalog } from "../../catalog/useCatalog";
import { CALORIES_RULE, NO_LONGER_IN_HEVY, RULE_NEEDED, usedIn } from "../messages";
import { PairingCards, initialPairingCards, type PairingDecision, type PairingNeed } from "./index";

const BENCH = makeExercise({ id: exerciseId(1), name: "Bench Press" });
const SQUAT = makeExercise({ id: exerciseId(2), name: "Back Squat" });
const tpl = (id: string, title: string, type = "weight_reps") =>
  ({ id, title, type, is_custom: true, primary_muscle_group: "chest", secondary_muscle_groups: [], equipment: "barbell" }) as HevyTemplate;
const NEEDS: PairingNeed[] = [
  { template: tpl("A", "Bench Press"), context: { workouts: 41, routines: 0 } },
  { template: tpl("E", "Echo Bike (calories)", "reps_only"), context: { workouts: 3, routines: 1 }, missing: true },
];

/** Test-only host: holds the cards, as 20.1 / 20.2 will. */
const reports: { valid: boolean; decisions: PairingDecision[] }[] = [];
function Host({ needs = NEEDS }: { needs?: PairingNeed[] }) {
  const { visible } = useCatalog();
  const [cards, setCards] = useState(() => initialPairingCards(needs, visible));
  return <PairingCards needs={needs} cards={cards} onCardsChange={setCards} onValidityChange={(v) => void reports.push(v)} />;
}

let requests: string[] = [];
beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  reports.length = 0;
  requests = [];
  server.events.on("request:start", ({ request }) => void requests.push(`${request.method} ${new URL(request.url).pathname}`));
});
afterEach(() => {
  server.events.removeAllListeners();
  unstubAccountEnv();
});

const host = (needs?: PairingNeed[]) =>
  renderHevyScreen(undefined, { catalog: [BENCH, SQUAT], path: "/host", routes: [{ path: "/host", element: <Host needs={needs} /> }] });

describe("20.0 AC26 — PairingCards", () => {
  it("one group per need, named by the Hevy title, with the type and where it is used", async () => {
    host();
    const bench = await screen.findByRole("group", { name: "Bench Press" });
    expect(bench).toHaveTextContent("Weight & reps");
    expect(bench).toHaveTextContent(usedIn(41, 0));
    expect(within(bench).getByRole("radio", { name: /Bench Press exact match/ })).toBeChecked();
    const bike = screen.getByRole("group", { name: "Echo Bike (calories)" });
    expect(bike).toHaveTextContent(usedIn(3, 1));
  });

  it("New is prefilled from the template, with the proposed rule ticked", async () => {
    host();
    const bike = await screen.findByRole("group", { name: "Echo Bike (calories)" });
    expect(within(bike).getByRole("radio", { name: "New exercise" })).toBeChecked();
    expect(within(bike).getByLabelText(/^Name/)).toHaveValue("Echo Bike (calories)");
    expect(within(bike).getByRole("checkbox", { name: CALORIES_RULE })).toBeChecked();
  });

  it("an unticked rule shows its reason as text and the cards are not valid until it is ticked again", async () => {
    host();
    const bike = await screen.findByRole("group", { name: "Echo Bike (calories)" });
    await waitFor(() => expect(reports.at(-1)?.valid).toBe(true));
    await userEvent.click(within(bike).getByRole("checkbox", { name: CALORIES_RULE }));
    expect(await within(bike).findByText(RULE_NEEDED)).toBeInTheDocument();
    await waitFor(() => expect(reports.at(-1)).toEqual({ valid: false, decisions: [] }));
    await userEvent.click(within(bike).getByRole("checkbox", { name: CALORIES_RULE }));
    await waitFor(() => expect(reports.at(-1)?.valid).toBe(true));
    expect(reports.at(-1)!.decisions.map((d) => d.action)).toEqual(["pair", "create"]);
  });

  it("Choose another opens the picker with no create row", async () => {
    host();
    await userEvent.click(await screen.findByRole("button", { name: "Choose another… for Bench Press" }));
    const picker = await screen.findByRole("dialog");
    expect(within(picker).queryByRole("button", { name: /Create/ })).toBeNull();
    await userEvent.click(within(picker).getByRole("button", { name: /Back Squat/ }));
    expect(await screen.findByRole("radio", { name: "Back Squat" })).toBeChecked();
  });

  it("the missing label shows only for a need marked missing", async () => {
    host();
    expect(await screen.findByRole("group", { name: "Echo Bike (calories)" })).toHaveTextContent(NO_LONGER_IN_HEVY);
    expect(screen.getByRole("group", { name: "Bench Press" })).not.toHaveTextContent(NO_LONGER_IN_HEVY);
  });

  it("20.0 AC29 — nothing is fetched or written beyond the catalog's reference data, even on unmount", async () => {
    const { unmount } = host();
    await screen.findByRole("group", { name: "Bench Press" });
    unmount();
    const writes = requests.filter((r) => !r.startsWith("GET "));
    expect(writes).toEqual([]);
    expect(requests.filter((r) => !/\/v1\/(exercises|muscle-groups|equipment)$/.test(r.slice(4)))).toEqual([]);
  });
});
