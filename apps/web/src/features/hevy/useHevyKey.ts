import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { useSession } from "../../auth/useSession";
import { reportError } from "../../observability/reportError";
import { HevyError } from "./client/hevyErrors";
import { HEVY_KEYS } from "./keys";
import { HEVY_KEY_SHAPE, hevyKeyStore } from "./keyStore";
import { HEVY_COPY, KEY_NOT_PRO, KEY_SHAPE_ERROR } from "./messages";
import { hevyClientFor } from "./sharedClient";

export type SaveKeyResult = { ok: true; username: string | null; remembered: boolean } | { ok: false; message: string };

/**
 * Spec 20.0 AC3–AC6: the signed-in user's Hevy key. `save` checks a pasted key against Hevy (`user/info`) with that
 * key before anything is stored, so a key that fails never replaces a working one. Only the last four characters
 * leave this hook.
 */
export function useHevyKey() {
  const userId = useSession().user?.id ?? null;
  const queryClient = useQueryClient();
  const key = useSyncExternalStore(hevyKeyStore.subscribe, () => (userId === null ? null : hevyKeyStore.get(userId)));
  // Minor 175: one controller per check, aborted on unmount and on a user change, so a late reply stores nothing.
  const checking = useRef<AbortController | null>(null);
  useEffect(() => () => checking.current?.abort(), [userId]);

  const save = useCallback(
    async (raw: string, opts: { remember: boolean }): Promise<SaveKeyResult> => {
      if (userId === null) return { ok: false, message: HEVY_COPY.unexpected_reply };
      const trimmed = raw.trim();
      if (!HEVY_KEY_SHAPE.safeParse(trimmed).success) return { ok: false, message: KEY_SHAPE_ERROR };
      try {
        checking.current?.abort();
        const controller = new AbortController();
        checking.current = controller;
        // A candidate client: the pasted key, not the stored one, goes to Hevy.
        const info = await hevyClientFor(() => trimmed).userInfo(controller.signal);
        if (controller.signal.aborted) return { ok: false, message: HEVY_COPY.aborted };
        if (!info.data.is_pro) return { ok: false, message: KEY_NOT_PRO };
        const { remembered } = hevyKeyStore.set(userId, trimmed, opts);
        queryClient.removeQueries({ queryKey: HEVY_KEYS.userAll });
        // Phase B: another key may see other templates.
        queryClient.removeQueries({ queryKey: HEVY_KEYS.templates });
        queryClient.setQueryData(HEVY_KEYS.user(userId), info);
        return { ok: true, username: info.data.username ?? info.data.name ?? null, remembered };
      } catch (err) {
        const kind = err instanceof HevyError ? err.kind : "unexpected_reply";
        // §9: only the failures worth a look are reported, with static tags and the static-message error.
        if (kind === "unexpected_reply" || kind === "server") reportError(err instanceof HevyError ? err : new HevyError(kind), { source: "hevy", op: "verify" });
        // AC5: a 404 ("User not found") reads as a key Hevy did not accept.
        return { ok: false, message: kind === "not_found" ? HEVY_COPY.bad_key : HEVY_COPY[kind] };
      }
    },
    [userId, queryClient],
  );

  const remove = useCallback(() => {
    if (userId === null) return;
    hevyKeyStore.remove(userId);
    queryClient.removeQueries({ queryKey: HEVY_KEYS.userAll });
    queryClient.removeQueries({ queryKey: HEVY_KEYS.templates });
  }, [userId, queryClient]);

  return { hasKey: key !== null, lastFour: key === null ? null : key.slice(-4), save, remove };
}
