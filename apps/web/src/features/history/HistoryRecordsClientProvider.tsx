import { useMemo, type ReactNode } from "react";
import { useApi } from "../../auth/useApi";
import { RecordsClientContext } from "../records/queries";
import { createRecordsClient } from "../records/recordsClient";
import { createHistoryClient } from "./historyClient";
import { HistoryClientContext } from "./queries";

/** Supplies the two read-only clients of Spec 08.0 (§6.6). Tests inject fakes through the contexts. */
export function HistoryRecordsClientProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const history = useMemo(() => createHistoryClient(api), [api]);
  const records = useMemo(() => createRecordsClient(api), [api]);
  return (
    <HistoryClientContext.Provider value={history}>
      <RecordsClientContext.Provider value={records}>{children}</RecordsClientContext.Provider>
    </HistoryClientContext.Provider>
  );
}
