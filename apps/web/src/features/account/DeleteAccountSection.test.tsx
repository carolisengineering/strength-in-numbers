import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ACCOUNT_PURGE_GRACE_DAYS } from "@sin/core";
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

import { server } from "../../test/msw/server";
import { ACCOUNT_URL, EXPORT_FILENAME, EXPORT_URL, ME_URL, makeQueryClient, problem, stubAccountEnv, unstubAccountEnv } from "../../test/accountHarness";
import { STEP_SETTLE_MS } from "./messages";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { useExportAccount } from "./useExportAccount";

function Harness() {
  const exporter = useExportAccount();
  return <DeleteAccountSection exporter={exporter} timeZone="Europe/London" />;
}
const renderIt = () => {
  const queryClient = makeQueryClient();
  render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
  return { queryClient };
};

let deleteCalls = 0;
let exportCalls = 0;
beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  auth.state.logout = vi.fn();
  saver.saveBlob.mockReset();
  deleteCalls = 0;
  exportCalls = 0;
  server.use(http.delete(ACCOUNT_URL, () => { deleteCalls += 1; return HttpResponse.json({ deletedAt: "2026-10-14T02:00:00.000Z", purgeEligibleAt: "2026-11-13T02:00:00.000Z" }, { status: 202 }); }));
});
afterEach(() => {
  vi.useRealTimers();
  unstubAccountEnv();
});

const trigger = () => screen.getByRole("button", { name: "Delete account…" });
const dialog = () => within(screen.getByRole("dialog"));
const openStep1 = async (user = userEvent) => user.click(trigger());
const toStep2 = async (user = userEvent) => {
  await openStep1(user);
  await user.click(dialog().getByRole("button", { name: "Continue" }));
};
const settledConfirm = async () => {
  const confirm = dialog().getByRole("button", { name: "Delete my account" });
  await waitFor(() => expect(confirm).toBeEnabled(), { timeout: STEP_SETTLE_MS + 1500 });
  return confirm;
};
const failDelete = (response: () => Response) =>
  server.use(http.delete(ACCOUNT_URL, () => { deleteCalls += 1; return response(); }));

describe("12 AC13 — the Delete account section", () => {
  it("is a region labeled by an h2, outside any form, and the button only opens the dialog", async () => {
    renderIt();
    const region = screen.getByRole("region", { name: "Delete account" });
    expect(within(region).getByRole("heading", { level: 2, name: "Delete account" })).toBeInTheDocument();
    expect(within(region).getByText("Lock your account and schedule your data for erasure.")).toBeInTheDocument();
    expect(trigger().closest("form")).toBeNull();
    await userEvent.click(trigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deleteCalls).toBe(0);
  });
});

describe("12 AC14 — step 1", () => {
  it("states lock, the grace days from @sin/core, no self-undo, no download after Continue, and backups", async () => {
    renderIt();
    await openStep1();
    expect(dialog().getByRole("heading", { name: "Delete your account?" })).toBeInTheDocument();
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toContain(`at least ${ACCOUNT_PURGE_GRACE_DAYS} days`);
    expect(text).toContain("locks right away on every device");
    expect(text).toContain("You can't undo this yourself");
    expect(text).toContain("you can't download your data after you continue");
    expect(text).toContain("Backups age out on the hosting provider's schedule.");
    expect(dialog().getByRole("button", { name: "Download my data first" })).toBeInTheDocument();
  });
  it("orders Cancel before Continue and focuses Cancel", async () => {
    renderIt();
    await openStep1();
    const buttons = dialog().getAllByRole("button").map((b) => b.textContent);
    expect(buttons.indexOf("Cancel")).toBeLessThan(buttons.indexOf("Continue"));
    expect(document.activeElement).toBe(dialog().getByRole("button", { name: "Cancel" }));
  });
});

describe("12 AC15 — download first, inside the dialog, same exporter", () => {
  it("one request, a Saved status in the dialog, and Continue never disabled by the export", async () => {
    server.use(http.get(EXPORT_URL, () => {
      exportCalls += 1;
      return new HttpResponse('{"formatVersion":1}', {
        status: 200,
        headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${EXPORT_FILENAME}"` },
      });
    }));
    renderIt();
    await openStep1();
    await userEvent.click(dialog().getByRole("button", { name: "Download my data first" }));
    expect(dialog().getByRole("button", { name: "Continue" })).toBeEnabled();
    await dialog().findByText(/^Saved /);
    expect(exportCalls).toBe(1);
    expect(saver.saveBlob).toHaveBeenCalledTimes(1);
  });
});

describe("12 AC16 — step 2 and the double-tap guard", () => {
  it("shows the Are you sure? content, sends nothing, and keeps Delete my account inert for 700 ms", () => {
    // Pure fake time (no shouldAdvanceTime: real elapsed ms would count toward the 699/700 boundary) and
    // synchronous fireEvent (userEvent's internal waits hang under pure fake timers).
    vi.useFakeTimers();
    renderIt();
    fireEvent.click(trigger());
    fireEvent.click(dialog().getByRole("button", { name: "Continue" }));
    expect(dialog().getByRole("heading", { name: "Are you sure?" })).toBeInTheDocument();
    expect(dialog().getByText("Your account will be locked right away. This can't be undone from the app.")).toBeInTheDocument();
    const confirm = dialog().getByRole("button", { name: "Delete my account" });
    expect(confirm).toBeDisabled();
    expect(document.activeElement).toBe(dialog().getByRole("button", { name: "Cancel" }));
    act(() => { vi.advanceTimersByTime(STEP_SETTLE_MS - 1); });
    expect(confirm).toBeDisabled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(confirm).toBeEnabled();
    expect(deleteCalls).toBe(0);
  });
});

describe("12 AC17 — Cancel sends nothing and resets", () => {
  it.each([["step 1"], ["step 2"]])("Cancel at %s closes, sends nothing, and the next open is step 1", async (where) => {
    renderIt();
    if (where === "step 1") await openStep1(); else await toStep2();
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { hidden: false })).toBeNull();
    expect(deleteCalls).toBe(0);
    await userEvent.click(trigger());
    expect(dialog().getByRole("heading", { name: "Delete your account?" })).toBeInTheDocument();
  });
  it("the native cancel event (Escape / Android back) at step 2 does the same", async () => {
    renderIt();
    await toStep2();
    act(() => { screen.getByRole("dialog").dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteCalls).toBe(0);
  });
});

describe("12 AC18 — in flight", () => {
  it("sends exactly one DELETE with no body, disables both buttons, and a second activation sends nothing", async () => {
    let release!: () => void;
    let bodyText = "unset";
    server.use(http.delete(ACCOUNT_URL, async ({ request }) => {
      deleteCalls += 1;
      bodyText = await request.text();
      await new Promise<void>((resolve) => { release = resolve; });
      return HttpResponse.json({ deletedAt: "2026-10-14T02:00:00.000Z", purgeEligibleAt: "2026-11-13T02:00:00.000Z" }, { status: 202 });
    }));
    renderIt();
    await toStep2();
    const confirm = await settledConfirm();
    // Two clicks in ONE act: the busy/disabled state has not rendered between them, so only the `sending`
    // ref stops the second DELETE (userEvent.dblClick yields in between).
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(deleteCalls).toBe(1));
    expect(bodyText).toBe("");
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(dialog().getByRole("button", { name: "Cancel" })).toBeDisabled();
    release();
    expect(deleteCalls).toBe(1);
  });

  it("Escape during the request closes and resets the dialog, and a later failure reopens it at step 2", async () => {
    let fail!: () => void;
    server.use(http.delete(ACCOUNT_URL, async () => {
      deleteCalls += 1;
      await new Promise<void>((resolve) => { fail = resolve; });
      return problem(500, "internal");
    }));
    renderIt();
    await toStep2();
    await userEvent.click(await settledConfirm());
    await waitFor(() => expect(deleteCalls).toBe(1));
    act(() => { screen.getByRole("dialog").dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    fail();
    expect(await screen.findByRole("heading", { name: "Are you sure?" })).toBeInTheDocument();
    expect(dialog().getByText("Couldn't delete your account.")).toBeInTheDocument();
    // AC19: the settle guard does not re-apply to a reopen after a failure.
    expect(dialog().getByRole("button", { name: "Delete my account" })).toBeEnabled();
  });

  it("a second visit to step 2 starts inert again (Cancel resets the guard)", async () => {
    renderIt();
    await toStep2();
    await settledConfirm();
    await userEvent.click(dialog().getByRole("button", { name: "Cancel" }));
    await toStep2();
    expect(dialog().getByRole("button", { name: "Delete my account" })).toBeDisabled();
  });
});

describe("12 AC19 — failure paths", () => {
  it.each([
    ["offline", () => HttpResponse.error(), "You're offline. Connect and try again."],
    ["429", () => problem(429, "rate-limited", { "retry-after": "7" }), "Too many attempts. Try again in 7 seconds."],
    ["500", () => problem(500, "internal"), "Couldn't delete your account."],
  ])("%s: role=alert text, both buttons enabled at once, retry sends a new request", async (_n, response, text) => {
    failDelete(response);
    renderIt();
    await toStep2();
    await userEvent.click(await settledConfirm());
    const alert = await dialog().findByRole("alert");
    expect(alert).toHaveTextContent(text);
    expect(dialog().getByRole("button", { name: "Delete my account" })).toBeEnabled(); // the settle guard does not re-apply
    expect(dialog().getByRole("button", { name: "Cancel" })).toBeEnabled();
    await userEvent.click(dialog().getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(deleteCalls).toBe(2));
  });

  it("a 500 shows the request id", async () => {
    failDelete(() => problem(500, "internal"));
    renderIt();
    await toStep2();
    await userEvent.click(await settledConfirm());
    expect(await dialog().findByText(/Request ID:/)).toBeInTheDocument();
  });

  it("a 403 account-deleted shows no message and invalidates the me query", async () => {
    failDelete(() => problem(403, "account-deleted"));
    server.use(http.get(ME_URL, () => problem(403, "account-deleted")));
    const { queryClient } = renderIt();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await toStep2();
    await userEvent.click(await settledConfirm());
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a 401 shows no message (the client's onAuthLost has started the logout)", async () => {
    failDelete(() => problem(401, "invalid-token"));
    renderIt();
    await toStep2();
    await userEvent.click(await settledConfirm());
    await waitFor(() => expect(auth.state.logout).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
