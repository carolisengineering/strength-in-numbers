import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ requestBlob: vi.fn() }));
vi.mock("../../auth/useApi", () => ({ useApi: () => api }));
const saver = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock("./saveBlob", () => ({ saveBlob: saver.saveBlob }));
const reporter = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../observability/reportError", () => ({ reportError: reporter.reportError }));

import { useExportAccount } from "./useExportAccount";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  api.requestBlob.mockReset();
  saver.saveBlob.mockReset();
  reporter.reportError.mockReset();
});

describe("12 AC11 — a response that lands after the screen is gone", () => {
  it("is not saved, shown or reported, even when the transport ignores the abort signal", async () => {
    let land!: () => void;
    let signal: AbortSignal | undefined;
    // A transport that never honors the signal: the worst case for "nothing is saved after unmount".
    api.requestBlob.mockImplementation((_path: string, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise((resolve) => {
        land = () => resolve({ blob: new Blob(["{}"]), filename: "late.json" });
      });
    });
    const { result, unmount } = renderHook(() => useExportAccount(), { wrapper });

    await act(async () => result.current.exportNow());
    expect(api.requestBlob).toHaveBeenCalledTimes(1);
    unmount();
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      land();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(saver.saveBlob).not.toHaveBeenCalled();
    expect(reporter.reportError).not.toHaveBeenCalled();
  });

  it("a failure that lands after unmount is not reported either", async () => {
    let fail!: () => void;
    api.requestBlob.mockImplementation(
      () => new Promise((_resolve, reject) => { fail = () => reject(new Error("late failure")); }),
    );
    const { result, unmount } = renderHook(() => useExportAccount(), { wrapper });

    await act(async () => result.current.exportNow());
    expect(api.requestBlob).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      fail();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(saver.saveBlob).not.toHaveBeenCalled();
    expect(reporter.reportError).not.toHaveBeenCalled();
  });
});
