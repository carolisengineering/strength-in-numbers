import { createContext, useContext } from "react";
import type { HistoryClient } from "./historyClient";

/** `["history"]` prefixes every history query, so one invalidation covers them (Spec 08.0 §6.1). */
export const HISTORY_KEYS = {
  all: ["history"] as const,
  list: ["history", "list"] as const,
};

export const HistoryClientContext = createContext<HistoryClient | null>(null);

export function useHistoryClient(): HistoryClient {
  const client = useContext(HistoryClientContext);
  if (client === null) throw new Error("useHistoryClient() must be used inside <HistoryRecordsClientProvider>");
  return client;
}
