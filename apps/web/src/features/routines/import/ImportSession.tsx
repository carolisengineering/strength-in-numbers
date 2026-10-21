import type { ReadResult } from "@sin/core";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Outlet } from "react-router";

import type { CardState } from "./cards";
import type { ImportHandoff } from "./handoff";
import type { SaveRecord } from "./saveImport";

/**
 * Spec 10.4 §6.2, AC20: the import session — the pasted text, the read, the cards and the hand-off. Plain
 * React state under the import layout route, never persisted, never in a URL or router state: leaving the
 * import screens unmounts it, and a reload starts empty.
 */
export interface ImportSessionValue {
  readonly text: string;
  readonly setText: (text: string) => void;
  readonly read: { readonly text: string; readonly result: ReadResult } | null;
  /** Clears the cards and the hand-off only when the text differs from the last read. */
  readonly commitRead: (text: string, result: ReadResult) => void;
  readonly cards: readonly CardState[] | null;
  readonly setCards: (cards: readonly CardState[]) => void;
  readonly updateCard: (key: string, change: (card: CardState) => CardState) => void;
  /** A placeholder exercise id, minted once per card key per session. */
  readonly placeholderFor: (cardKey: string) => string;
  readonly handoff: ImportHandoff | null;
  readonly setHandoff: (handoff: ImportHandoff) => void;
  /** Spec 10.4 AC32: what Save created so far, so a retry never creates an exercise twice. One per session. */
  readonly saveRecord: SaveRecord;
}

const ImportSessionContext = createContext<ImportSessionValue | null>(null);

export function ImportSessionProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  const [read, setRead] = useState<ImportSessionValue["read"]>(null);
  const [cards, setCards] = useState<readonly CardState[] | null>(null);
  const [handoff, setHandoff] = useState<ImportHandoff | null>(null);
  const placeholders = useRef(new Map<string, string>());
  const saveRecord = useRef<SaveRecord>({ created: new Map(), attempts: 0 });

  const readText = useRef<string | null>(null);

  const commitRead = useCallback((next: string, result: ReadResult) => {
    if (readText.current !== next) {
      setCards(null);
      setHandoff(null);
    }
    readText.current = next;
    setRead({ text: next, result });
  }, []);

  const updateCard = useCallback((key: string, change: (card: CardState) => CardState) => {
    setCards((current) => current?.map((card) => (card.key === key ? change(card) : card)) ?? null);
  }, []);

  const placeholderFor = useCallback((cardKey: string) => {
    let id = placeholders.current.get(cardKey);
    if (id === undefined) {
      id = crypto.randomUUID();
      placeholders.current.set(cardKey, id);
    }
    return id;
  }, []);

  const value = useMemo<ImportSessionValue>(
    () => ({ text, setText, read, commitRead, cards, setCards, updateCard, placeholderFor, handoff, setHandoff, saveRecord: saveRecord.current }),
    [text, read, commitRead, cards, updateCard, placeholderFor, handoff],
  );
  return <ImportSessionContext.Provider value={value}>{children}</ImportSessionContext.Provider>;
}

export function useImportSession(): ImportSessionValue {
  const session = useContext(ImportSessionContext);
  if (session === null) throw new Error("useImportSession outside ImportSessionProvider");
  return session;
}

/** The layout element of the import routes: one session for the paste, names and edit screens. */
export function ImportLayout() {
  return (
    <ImportSessionProvider>
      <Outlet />
    </ImportSessionProvider>
  );
}
