import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BlobResponse } from "../../api/client";
import { useApi } from "../../auth/useApi";
import { reportError } from "../../observability/reportError";
import { isAccountDeleted, isSessionEnded, notifyIfAccountDeleted } from "./accountDeleted";
import { EXPORT_FALLBACK_FILENAME } from "./messages";
import { saveBlob } from "./saveBlob";

export type ExportState =
  | { readonly status: "idle" }
  | { readonly status: "preparing" }
  | { readonly status: "saved"; readonly filename: string }
  | { readonly status: "error"; readonly error: unknown };

export interface ExportAccount {
  readonly state: ExportState;
  exportNow: () => void;
  saveAgain: () => void;
}

/**
 * `GET /v1/account/export` as an explicit user action (Spec 12 §6.2, AC6-AC11). `useMutation`, not
 * `useQuery`: it must never refetch on focus. `networkMode: "always"` makes offline a visible failure
 * instead of a paused spinner. Called ONCE per Profile screen and shared with the delete dialog (D13).
 * The Blob lives in a ref (memory only) and is dropped on unmount; unmounting aborts the request, and
 * because TanStack drops `mutate()`-level callbacks for an unmounted component nothing is saved or shown.
 */
export function useExportAccount(): ExportAccount {
  const api = useApi();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ExportState>({ status: "idle" });
  const held = useRef<BlobResponse | null>(null);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);

  const mutation = useMutation<BlobResponse, Error, AbortSignal>({
    networkMode: "always",
    mutationFn: (signal) =>
      api.requestBlob("/v1/account/export", { signal, fallbackFilename: EXPORT_FALLBACK_FILENAME }),
    onError: (error) => notifyIfAccountDeleted(error, queryClient),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  useEffect(
    () => () => {
      controller.current?.abort();
      held.current = null;
    },
    [],
  );

  const exportNow = useCallback(() => {
    if (inFlight.current) return; // a double tap in the same tick sends one request
    inFlight.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setState({ status: "preparing" });
    mutation.mutate(abort.signal, {
      onSuccess: (result) => {
        if (abort.signal.aborted) return;
        held.current = result;
        try {
          saveBlob(result.blob, result.filename);
          setState({ status: "saved", filename: result.filename });
        } catch (error) {
          reportError(error, { source: "account-export" }); // static tag only: never the Blob, name or message
          setState({ status: "error", error });
        }
      },
      onError: (error) => {
        if (abort.signal.aborted) return; // unmount: the client wraps AbortError in ApiError.network
        // A 403 account-deleted is handled by invalidating `me` (D7); the layout swaps this screen out.
        if (isAccountDeleted(error)) return;
        // A 401 means onAuthLost has started the logout (AC10): no notice for a session that is ending.
        if (isSessionEnded(error)) {
          setState({ status: "idle" });
          return;
        }
        setState({ status: "error", error });
      },
    });
  }, [mutation]);

  const saveAgain = useCallback(() => {
    const current = held.current;
    if (!current) return;
    try {
      saveBlob(current.blob, current.filename);
    } catch (error) {
      reportError(error, { source: "account-export" });
      setState({ status: "error", error });
    }
  }, []);

  return { state, exportNow, saveAgain };
}
