import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const reporter = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../observability/reportError", () => ({ reportError: reporter.reportError }));

import { server } from "../../test/msw/server";
import {
  EXPORT_FILENAME, EXPORT_URL, ME_URL, exportOk, makeQueryClient, problem, stubAccountEnv, unstubAccountEnv,
} from "../../test/accountHarness";
import { ME_QUERY_KEY } from "../me/useMe";
import { AccountDataSection } from "./AccountDataSection";
import { useExportAccount } from "./useExportAccount";

function Harness() {
  const exporter = useExportAccount();
  return <AccountDataSection exporter={exporter} />;
}
function renderSection() {
  const queryClient = makeQueryClient();
  const view = render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
  return { queryClient, ...view };
}

let exportCalls = 0;
beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  auth.state.logout = vi.fn();
  saver.saveBlob.mockReset();
  reporter.reportError.mockReset();
  exportCalls = 0;
});
afterEach(unstubAccountEnv);

const section = () => within(screen.getByRole("region", { name: "Your data" }));
const countingExport = (respond: () => Response | Promise<Response>) =>
  server.use(http.get(EXPORT_URL, () => { exportCalls += 1; return respond(); }));
const okResponse = () => new HttpResponse('{"formatVersion":1}', {
  status: 200,
  headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${EXPORT_FILENAME}"` },
});

describe("12 AC5 — the Your data section", () => {
  it("shows the heading, one explanation, a full-width button, and makes no request", () => {
    server.use(exportOk());
    renderSection();
    expect(screen.getByRole("heading", { level: 2, name: "Your data" })).toBeInTheDocument();
    expect(section().getByText(/A file with your profile, custom exercises, routines and every workout, including sets and notes\./)).toBeInTheDocument();
    expect(section().getByRole("button", { name: "Download my data" })).toBeEnabled();
    expect(exportCalls).toBe(0);
  });
});

describe("12 AC6 — one request, a visible busy state", () => {
  it("sends exactly one GET even on a double click, and shows the busy label", async () => {
    let release!: () => void;
    countingExport(() => new Promise<Response>((resolve) => { release = () => resolve(okResponse()); }));
    renderSection();
    const button = section().getByRole("button", { name: "Download my data" });

    // Two clicks in ONE act: React has not re-rendered the disabled button between them, so only the
    // hook's in-flight ref stops the second request (userEvent.dblClick yields in between).
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    const busy = await section().findByRole("button", { name: "Preparing your data…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(exportCalls).toBe(1);
    act(() => release());
    await section().findByText(`Saved ${EXPORT_FILENAME}`);
    expect(exportCalls).toBe(1);
  });
});

describe("12 AC7 — success and re-download without a request", () => {
  it("saves once, shows Saved, and Download again re-saves the held Blob with no new request", async () => {
    countingExport(okResponse);
    const { unmount } = renderSection();

    await userEvent.click(section().getByRole("button", { name: "Download my data" }));
    await section().findByText(`Saved ${EXPORT_FILENAME}`);
    expect(saver.saveBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = saver.saveBlob.mock.calls[0]!;
    expect(filename).toBe(EXPORT_FILENAME);
    expect(await (blob as Blob).text()).toBe('{"formatVersion":1}');

    await userEvent.click(section().getByRole("button", { name: "Download again" }));
    expect(saver.saveBlob).toHaveBeenCalledTimes(2);
    expect(saver.saveBlob.mock.calls[1]![0]).toBe(blob);
    expect(exportCalls).toBe(1);
    unmount();
  });
});

describe("12 AC9 — failure copy and Try again", () => {
  it("offline: network failure shows the offline text, Try again re-requests", async () => {
    server.use(http.get(EXPORT_URL, () => { exportCalls += 1; return HttpResponse.error(); }));
    renderSection();
    await userEvent.click(section().getByRole("button", { name: "Download my data" }));
    expect(await section().findByText("You're offline. Connect and try again.")).toBeInTheDocument();
    await userEvent.click(section().getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(exportCalls).toBe(2));
  });

  it("429 shows the wait from Retry-After", async () => {
    server.use(http.get(EXPORT_URL, () => problem(429, "rate-limited", { "retry-after": "12" })));
    renderSection();
    await userEvent.click(section().getByRole("button", { name: "Download my data" }));
    expect(await section().findByText("Too many downloads. Try again in 12 seconds.")).toBeInTheDocument();
  });

  it("500 shows the generic text and the request id", async () => {
    server.use(http.get(EXPORT_URL, () => problem(500, "internal")));
    renderSection();
    await userEvent.click(section().getByRole("button", { name: "Download my data" }));
    expect(await section().findByText("Couldn't prepare your data.")).toBeInTheDocument();
    expect(section().getByText(/Request ID:/)).toBeInTheDocument();
  });

  it("a saveBlob throw is the generic failure and is reported with static tags only", async () => {
    countingExport(okResponse);
    saver.saveBlob.mockImplementation(() => { throw new Error("blocked"); });
    renderSection();
    await userEvent.click(section().getByRole("button", { name: "Download my data" }));
    expect(await section().findByText("Couldn't prepare your data.")).toBeInTheDocument();
    expect(reporter.reportError).toHaveBeenCalledWith(expect.any(Error), { source: "account-export" });
  });
});

describe("12 AC10 — account and session errors are not this screen's to show", () => {
  it("a 403 account-deleted shows no notice and invalidates the me query", async () => {
    server.use(http.get(EXPORT_URL, () => problem(403, "account-deleted")), http.get(ME_URL, () => problem(403, "account-deleted")));
    const { queryClient } = renderSection();
    queryClient.setQueryData(ME_QUERY_KEY, { id: "u" });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await userEvent.click(section().getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a 403 account-deleted leaves the button usable again (it is not stuck on Preparing)", async () => {
    server.use(http.get(EXPORT_URL, () => problem(403, "account-deleted")), http.get(ME_URL, () => HttpResponse.json({ id: "u" })));
    renderSection();
    await userEvent.click(section().getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(section().getByRole("button", { name: "Download my data" })).toBeEnabled());
  });

  it("a 401 shows no notice (the client's onAuthLost has started the logout)", async () => {
    server.use(http.get(EXPORT_URL, () => problem(401, "invalid-token")));
    renderSection();
    await userEvent.click(section().getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(auth.state.logout).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("12 AC11 — leaving the screen aborts; online-only", () => {
  it("unmounting mid-request aborts it and nothing is saved, shown or reported", async () => {
    let aborted = false;
    server.use(http.get(EXPORT_URL, ({ request }) => {
      exportCalls += 1;
      request.signal.addEventListener("abort", () => { aborted = true; });
      return new Promise<Response>(() => {});
    }));
    const { unmount } = renderSection();
    await userEvent.click(section().getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(exportCalls).toBe(1));
    unmount();
    await waitFor(() => expect(aborted).toBe(true));
    expect(saver.saveBlob).not.toHaveBeenCalled();
    expect(reporter.reportError).not.toHaveBeenCalled();
  });

  it("does not wait for connectivity: with navigator offline the request is still attempted and fails visibly", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    server.use(http.get(EXPORT_URL, () => HttpResponse.error()));
    renderSection();
    await userEvent.click(section().getByRole("button", { name: "Download my data" }));
    expect(await section().findByText("You're offline. Connect and try again.")).toBeInTheDocument();
  });
});
