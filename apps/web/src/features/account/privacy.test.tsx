import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
const saver = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock("./saveBlob", () => ({ saveBlob: saver.saveBlob }));
const seams = vi.hoisted(() => ({ reportError: vi.fn(), track: vi.fn() }));
vi.mock("../../observability/reportError", () => ({ reportError: seams.reportError }));
vi.mock("../../observability/track", () => ({ track: seams.track }));

import { server } from "../../test/msw/server";
import { ACCOUNT_URL, EXPORT_URL, makeQueryClient, problem, stubAccountEnv, unstubAccountEnv } from "../../test/accountHarness";
import { STEP_SETTLE_MS } from "./messages";
import { AccountDataSection } from "./AccountDataSection";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { useExportAccount } from "./useExportAccount";

// Distinctive text that must never reach an observability seam or the console (Spec 12 AC24, D10).
const SECRET_NAME = "ZZ-secret-lifter-export.json";
const SECRET_BODY = '{"email":"ZZ-secret@example.com","note":"ZZ-secret-note"}';
const SECRET_DETAIL = "ZZ-secret-detail";

function Harness() {
  const exporter = useExportAccount();
  return (
    <>
      <AccountDataSection exporter={exporter} />
      <DeleteAccountSection exporter={exporter} timeZone="Europe/London" />
    </>
  );
}

const consoleSpies = () =>
  (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));

/** Everything the seams and the console received, flattened, so one assertion covers all of it. */
const observed = (spies: ReturnType<typeof consoleSpies>): string =>
  JSON.stringify([seams.reportError.mock.calls, seams.track.mock.calls, ...spies.map((s) => s.mock.calls)], (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message } : v,
  );

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  auth.state.logout = vi.fn();
  saver.saveBlob.mockReset();
  seams.reportError.mockReset();
  seams.track.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  unstubAccountEnv();
});

const data = () => within(screen.getByRole("region", { name: "Your data" }));

describe("12 AC24 — no export content, name or message text reaches track / reportError / console", () => {
  it("across success, a save failure, a 500 with a body, a 429 and offline (the AC6–AC11 paths)", async () => {
    const spies = consoleSpies();
    render(<QueryClientProvider client={makeQueryClient()}><Harness /></QueryClientProvider>);

    // success
    server.use(http.get(EXPORT_URL, () => new HttpResponse(SECRET_BODY, {
      status: 200,
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${SECRET_NAME}"` },
    })));
    await userEvent.click(data().getByRole("button", { name: "Download my data" }));
    await data().findByText(`Saved ${SECRET_NAME}`);

    // the browser blocks the save (a real click error never carries our file name or body; the point is
    // that the hook adds nothing of its own to what it reports)
    saver.saveBlob.mockImplementationOnce(() => { throw new DOMException("The request is not allowed", "NotAllowedError"); });
    await userEvent.click(data().getByRole("button", { name: "Download again" }));
    await data().findByText("Couldn't prepare your data.");

    // a 500 whose problem body carries text
    server.use(http.get(EXPORT_URL, () => new HttpResponse(
      JSON.stringify({ type: "https://strengthinnumbers.app/problems/internal", title: SECRET_DETAIL, status: 500, detail: SECRET_DETAIL, instance: "req-1" }),
      { status: 500, headers: { "content-type": "application/problem+json" } },
    )));
    await userEvent.click(data().getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(data().getByText("Couldn't prepare your data.")).toBeInTheDocument());

    // a 429 and then offline
    server.use(http.get(EXPORT_URL, () => problem(429, "rate-limited", { "retry-after": "3" })));
    await userEvent.click(data().getByRole("button", { name: "Try again" }));
    await data().findByText(/Too many downloads/);
    server.use(http.get(EXPORT_URL, () => HttpResponse.error()));
    await userEvent.click(data().getByRole("button", { name: "Try again" }));
    await data().findByText("You're offline. Connect and try again.");

    expect(observed(spies)).not.toContain("ZZ-secret");
    // The save failure is the only thing reported, with the static tag and nothing else.
    expect(seams.reportError).toHaveBeenCalledTimes(1);
    expect(seams.reportError.mock.calls[0]![1]).toEqual({ source: "account-export" });
    expect(seams.track).not.toHaveBeenCalled();
  });

  it("across the delete failure paths", async () => {
    const spies = consoleSpies();
    render(<QueryClientProvider client={makeQueryClient()}><Harness /></QueryClientProvider>);
    server.use(http.delete(ACCOUNT_URL, () => new HttpResponse(
      JSON.stringify({ type: "https://strengthinnumbers.app/problems/internal", title: SECRET_DETAIL, status: 500, detail: SECRET_DETAIL, instance: "req-1" }),
      { status: 500, headers: { "content-type": "application/problem+json" } },
    )));
    await userEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Continue" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Delete my account" });
    await waitFor(() => expect(confirm).toBeEnabled(), { timeout: STEP_SETTLE_MS + 1500 });
    await userEvent.click(confirm);
    await within(screen.getByRole("dialog")).findByRole("alert");

    expect(observed(spies)).not.toContain("ZZ-secret");
    expect(seams.reportError).not.toHaveBeenCalled();
    expect(seams.track).not.toHaveBeenCalled();
  });
});
