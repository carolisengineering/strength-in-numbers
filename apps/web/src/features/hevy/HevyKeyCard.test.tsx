import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { stubAccountEnv, unstubAccountEnv } from "../../test/accountHarness";
import { server } from "../../test/msw/server";
import { HEVY_COPY, LOADING_USERNAME, QUIET_MINUTE, KEY_NOT_PRO, KEY_NOT_REMEMBERED, KEY_REMOVED, KEY_SAVED, KEY_SAVED_VISIT, KEY_SHAPE_ERROR, REMOVE_TITLE, keyEnding, signedInAs } from "./messages";
import {
  HEVY_USER_INFO_URL,
  OTHER_KEY,
  USER_ID,
  VALID_KEY,
  clearHevyKey,
  renderHevyScreen,
  setInstantPacing,
  userInfoOk,
} from "../../test/hevyHarness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HevyError } from "./client/hevyErrors";
import { HEVY_KEYS } from "./keys";
import { hevyKeyStorageKey, hevyKeyStore } from "./keyStore";

/** Every request to Hevy, with the key it carried. */
let hevyRequests: { path: string; key: string | null }[] = [];
let sinRequests: string[] = [];

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  setInstantPacing();
  clearHevyKey();
  window.localStorage.clear();
  hevyRequests = [];
  sinRequests = [];
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    if (url.hostname === "api.hevyapp.com") hevyRequests.push({ path: url.pathname, key: request.headers.get("api-key") });
    else sinRequests.push(`${request.method} ${url.pathname}`);
  });
});
afterEach(() => {
  server.events.removeAllListeners();
  clearHevyKey();
  window.localStorage.clear();
  vi.restoreAllMocks();
  unstubAccountEnv();
});

const keyInput = () => screen.getByLabelText("Hevy API key");
async function paste(value: string) {
  const input = keyInput();
  await userEvent.clear(input);
  await userEvent.click(input);
  await userEvent.paste(value);
}
const saveAndRemember = () => userEvent.click(screen.getByRole("button", { name: "Save and remember" }));
const status = () => screen.getByTestId("hevy-key-status");

describe("20.0 AC4 — key shape", () => {
  it("a pasted key with surrounding spaces and a newline is trimmed and accepted", async () => {
    server.use(userInfoOk());
    renderHevyScreen();
    await paste(`  ${VALID_KEY}\n`);
    await saveAndRemember();
    expect(await screen.findByText(keyEnding("beef"))).toBeInTheDocument();
    expect(hevyRequests).toEqual([{ path: "/v1/user/info", key: VALID_KEY }]);
  });

  it.each(["abc", "5ec7e7a1-0b5e-4c3d-9a8f-1234dead beef", "5ec7e7a1-0b5e-4c3d-9a8f-1234deadbee"])(
    "%j shows the shape sentence and makes no request",
    async (value) => {
      renderHevyScreen();
      await paste(value);
      await saveAndRemember();
      expect(await screen.findByText(KEY_SHAPE_ERROR)).toBeInTheDocument();
      expect(hevyRequests).toEqual([]);
      expect(hevyKeyStore.get(USER_ID)).toBeNull();
    },
  );

  it("the field is plain text with no autocomplete, capitalization or spellcheck", () => {
    renderHevyScreen();
    const input = keyInput();
    expect(input).not.toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("autocapitalize", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("after a save the field is gone and only the last four show", async () => {
    server.use(userInfoOk());
    renderHevyScreen();
    await paste(VALID_KEY);
    await saveAndRemember();
    await screen.findByText(keyEnding("beef"));
    expect(screen.queryByLabelText("Hevy API key")).toBeNull();
    expect(document.body.textContent).not.toContain(VALID_KEY);
  });
});

describe("20.0 AC5 — verification", () => {
  it("is_pro true stores the key and shows the ending and the username", async () => {
    server.use(userInfoOk());
    renderHevyScreen();
    await paste(VALID_KEY);
    await saveAndRemember();
    expect(await screen.findByText(keyEnding("beef"))).toBeInTheDocument();
    expect(await screen.findByText(signedInAs("jhon"))).toBeInTheDocument();
    expect(hevyKeyStore.get(USER_ID)).toBe(VALID_KEY);
    expect(status()).toHaveTextContent(KEY_SAVED);
  });

  it.each([
    ["401", () => http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ error: "Unauthorized" }, { status: 401 })), HEVY_COPY.bad_key],
    ["403", () => http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ error: "Forbidden" }, { status: 403 })), HEVY_COPY.bad_key],
    ["404", () => http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ error: "User not found" }, { status: 404 })), HEVY_COPY.bad_key],
    ["is_pro false", () => userInfoOk({ is_pro: false }), KEY_NOT_PRO],
    ["a network error", () => http.get(HEVY_USER_INFO_URL, () => HttpResponse.error()), HEVY_COPY.network],
    ["a schema failure", () => http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ data: { id: 1 } })), HEVY_COPY.unexpected_reply],
  ])("%s shows its sentence and stores nothing", async (_label, handler, sentence) => {
    server.use(handler());
    renderHevyScreen();
    await paste(VALID_KEY);
    await saveAndRemember();
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(hevyKeyStore.get(USER_ID)).toBeNull();
    expect(window.localStorage.getItem(hevyKeyStorageKey(USER_ID))).toBeNull();
  });

  it("the check carries the pasted key, not a stored one", async () => {
    hevyKeyStore.set(USER_ID, OTHER_KEY, { remember: true });
    server.use(userInfoOk());
    renderHevyScreen();
    await userEvent.click(await screen.findByRole("button", { name: "Replace" }));
    await paste(VALID_KEY);
    await saveAndRemember();
    await screen.findByText(keyEnding("beef"));
    expect(hevyRequests.at(-1)).toEqual({ path: "/v1/user/info", key: VALID_KEY });
  });
});

describe("20.0 AC6 — Replace and Remove", () => {
  it("a Replace that fails keeps the old key, and the next request still sends it", async () => {
    hevyKeyStore.set(USER_ID, OTHER_KEY, { remember: true });
    server.use(
      http.get(HEVY_USER_INFO_URL, ({ request }) =>
        request.headers.get("api-key") === OTHER_KEY ? userInfoReply() : HttpResponse.json({ error: "no" }, { status: 401 }),
      ),
    );
    renderHevyScreen();
    await screen.findByText(keyEnding("cafe"));
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    await paste(VALID_KEY);
    await saveAndRemember();
    expect(await screen.findByText(HEVY_COPY.bad_key)).toBeInTheDocument();
    expect(hevyKeyStore.get(USER_ID)).toBe(OTHER_KEY);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(keyEnding("cafe"))).toBeInTheDocument();
    expect(hevyRequests.filter((r) => r.key === OTHER_KEY).length).toBeGreaterThan(0);
  });

  it("a verified new key replaces the old one", async () => {
    hevyKeyStore.set(USER_ID, OTHER_KEY, { remember: true });
    server.use(userInfoOk());
    renderHevyScreen();
    await userEvent.click(await screen.findByRole("button", { name: "Replace" }));
    await paste(VALID_KEY);
    await saveAndRemember();
    expect(await screen.findByText(keyEnding("beef"))).toBeInTheDocument();
    expect(hevyKeyStore.get(USER_ID)).toBe(VALID_KEY);
  });

  it("Remove asks first, then deletes the key and shows the field again, with no SIN request", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
    server.use(userInfoOk());
    renderHevyScreen();
    expect(status()).toBeEmptyDOMElement();
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: REMOVE_TITLE });
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByLabelText("Hevy API key")).toBeInTheDocument();
    expect(hevyKeyStore.get(USER_ID)).toBeNull();
    expect(window.localStorage.getItem(hevyKeyStorageKey(USER_ID))).toBeNull();
    expect(status()).toHaveTextContent(KEY_REMOVED);
    // The screen reads the mapping and the catalog on open (Phase B); the key flow itself writes nothing to SIN.
    expect(sinRequests.filter((r) => !r.startsWith("GET "))).toEqual([]);
  });
});

describe("20.0 AC3 — the two save buttons", () => {
  it("Use for this visit only stores nothing on the device", async () => {
    server.use(userInfoOk());
    renderHevyScreen();
    await paste(VALID_KEY);
    await userEvent.click(screen.getByRole("button", { name: "Use for this visit only" }));
    await waitFor(() => expect(status()).toHaveTextContent(KEY_SAVED_VISIT));
    expect(window.localStorage.getItem(hevyKeyStorageKey(USER_ID))).toBeNull();
    expect(hevyKeyStore.get(USER_ID)).toBe(VALID_KEY);
  });

  it("Save and remember writes the key", async () => {
    server.use(userInfoOk());
    renderHevyScreen();
    await paste(VALID_KEY);
    await saveAndRemember();
    await waitFor(() => expect(window.localStorage.getItem(hevyKeyStorageKey(USER_ID))).toBe(JSON.stringify({ v: 1, key: VALID_KEY })));
  });

  it("storage that refuses the write keeps the key for this visit and says so", async () => {
    server.use(userInfoOk());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    renderHevyScreen();
    await paste(VALID_KEY);
    await saveAndRemember();
    await waitFor(() => expect(status()).toHaveTextContent(KEY_NOT_REMEMBERED));
    expect(hevyKeyStore.get(USER_ID)).toBe(VALID_KEY);
  });
});

describe("20.0 AC15 — offline", () => {
  it("Save offline shows the network sentence, and a stored key still shows its last four", async () => {
    server.use(http.get(HEVY_USER_INFO_URL, () => HttpResponse.error()));
    renderHevyScreen();
    await paste(VALID_KEY);
    await saveAndRemember();
    expect(await screen.findByText(HEVY_COPY.network)).toBeInTheDocument();
  });

  it("a stored key renders its ending even when Hevy is unreachable", async () => {
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: true });
    server.use(http.get(HEVY_USER_INFO_URL, () => HttpResponse.error()));
    renderHevyScreen();
    expect(await screen.findByText(keyEnding("beef"))).toBeInTheDocument();
    expect(await screen.findByText(HEVY_COPY.network)).toBeInTheDocument();
  });
});

function userInfoReply() {
  return HttpResponse.json({ data: { id: "u1", username: "jhon", name: "John", url: "https://hevy.com/user/jhon", is_pro: true } });
}

describe("Minor 167 — a wait is explained", () => {
  it("in the first minute of an hour, a busy Save says why it waits", async () => {
    server.use(http.get(HEVY_USER_INFO_URL, () => new Promise<never>(() => {})));
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-28T13:00:10.000Z"));
    renderHevyScreen();
    await paste(VALID_KEY);
    await saveAndRemember();
    expect(await screen.findByText(QUIET_MINUTE)).toBeInTheDocument();
  });

  it("with a stored key, a loading line shows while the username is read", async () => {
    server.use(http.get(HEVY_USER_INFO_URL, () => new Promise<never>(() => {})));
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    renderHevyScreen();
    expect(await screen.findByText(LOADING_USERNAME)).toBeInTheDocument();
  });
});

describe("Minor 171 — status focus is visible and a later failure is announced", () => {
  it("the status line has a focus ring from the tokens", () => {
    const css = readFileSync(join(__dirname, "HevyKeyCard.module.css"), "utf8");
    expect(css).toMatch(/\.status:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring-width\)\s+solid\s+var\(--color-focus\)/);
  });

  it("a stored key Hevy now refuses is announced in the status region", async () => {
    server.use(http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ error: "Invalid api key" }, { status: 401 })));
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    renderHevyScreen();
    await waitFor(() => expect(status()).toHaveTextContent(HEVY_COPY.bad_key));
  });
});

describe("Minor 171 — a refusal after a save in the same visit is announced (final review)", () => {
  it("'Key saved.' gives way to the bad-key sentence when Hevy later refuses the key", async () => {
    server.use(userInfoOk());
    const { queryClient } = renderHevyScreen();
    await paste(VALID_KEY);
    await saveAndRemember();
    await waitFor(() => expect(status()).toHaveTextContent(KEY_SAVED));
    server.use(http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ error: "Invalid api key" }, { status: 401 })));
    await queryClient.refetchQueries({ queryKey: HEVY_KEYS.userAll });
    await waitFor(() => expect(status()).toHaveTextContent(HEVY_COPY.bad_key));
  });
});

describe("Minor 199 — the quiet-minute line appears at the boundary and goes after it", () => {
  afterEach(() => vi.useRealTimers());
  it("a save started at :59:59 shows the line at :00:00, in a polite live region, and drops it at :01:00", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true, now: new Date("2026-10-29T14:59:59.000Z") });
    server.use(http.get(HEVY_USER_INFO_URL, () => new Promise<never>(() => {})));
    renderHevyScreen();
    await paste(VALID_KEY);
    await saveAndRemember();
    const region = document.querySelector<HTMLElement>('[aria-live="polite"][data-testid="hevy-quiet-minute"]');
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();
    await vi.advanceTimersByTimeAsync(1_000);
    await waitFor(() => expect(region).toHaveTextContent(QUIET_MINUTE));
    await vi.advanceTimersByTimeAsync(60_000);
    await waitFor(() => expect(region).toBeEmptyDOMElement());
    expect(document.contains(region)).toBe(true);
  });
});

describe("Minor 203 — a refused stored key is named under its ending", () => {
  it("when the status line already names the refusal, it shows once (final review: no duplicate)", async () => {
    server.use(http.get(HEVY_USER_INFO_URL, () => HttpResponse.json({ error: "Invalid api key" }, { status: 401 })));
    hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
    renderHevyScreen();
    await waitFor(() => expect(status()).toHaveTextContent(HEVY_COPY.bad_key));
    expect(screen.getAllByText(HEVY_COPY.bad_key)).toHaveLength(1);
  });

  it("Review Focus 4 — a newer outcome on the status line leaves the refusal named, not live, under the ending", async () => {
    server.use(userInfoOk());
    const { queryClient } = renderHevyScreen();
    await paste(VALID_KEY);
    await saveAndRemember();
    await waitFor(() => expect(status()).toHaveTextContent(KEY_SAVED));
    // Hevy's refusal, recorded before the save's announcement: the status line keeps the newer outcome.
    const query = queryClient.getQueryCache().find({ queryKey: HEVY_KEYS.user(USER_ID) })!;
    act(() => query.setState({ status: "error", error: new HevyError("bad_key"), errorUpdatedAt: 1 }));
    const ending = screen.getByText(keyEnding(VALID_KEY.slice(-4)));
    const under = await within(ending.parentElement!).findByText(HEVY_COPY.bad_key);
    expect(under.closest('[role="status"], [aria-live]')).toBeNull();
    expect(status()).toHaveTextContent(KEY_SAVED);
  });
});
