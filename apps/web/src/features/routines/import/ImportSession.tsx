import type { ReadResult } from "@sin/core";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate, useNavigationType } from "react-router";

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
  /**
   * Spec 10.4 AC32: what Save created so far, so a retry never creates an exercise twice. One per session, and kept
   * on purpose when the pasted text changes (DM-33): the same name key gets the same placeholder, so an exercise an
   * earlier Save created is reused, not created again. Clearing it here would make duplicate exercises.
   */
  readonly saveRecord: SaveRecord;
  /** Go Back (instead of pushing) when the entry behind this one is `pathname`; false when it is not (deferred minor 27). */
  readonly backTo: (pathname: string) => boolean;
  /** Leave the import for `path`, giving up every import history entry, so one Back returns to where it began (deferred minor 31). */
  readonly leaveTo: (path: string) => void;
}

interface Entry {
  readonly key: string;
  readonly pathname: string;
}

/**
 * The import screens' own history entries, mirrored in memory from the router's navigations (nothing goes in
 * router state, AC20), with a cursor so Back and Forward move over them as the browser does. `leaveTo` goes back
 * to the first entry, then replaces it.
 */
function useImportHistory(): Pick<ImportSessionValue, "backTo" | "leaveTo"> {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  const history = useRef<{ entries: Entry[]; at: number }>({ entries: [], at: -1 });
  const pending = useRef<string | null>(null);

  useLayoutEffect(() => {
    const h = history.current;
    const here = { key: location.key, pathname: location.pathname };
    if (h.entries[h.at]?.key === here.key) return;
    if (h.at < 0 || type === "PUSH") {
      h.entries = [...h.entries.slice(0, h.at + 1), here];
      h.at += 1;
    } else if (type === "REPLACE") {
      h.entries[h.at] = here;
    } else {
      const index = h.entries.findIndex((e) => e.key === here.key);
      if (index >= 0) h.at = index;
      else history.current = { entries: [here], at: 0 };
    }
    // The Back that `leaveTo` started has landed: whatever entry it reached gives way to the destination.
    if (pending.current !== null && type === "POP") {
      const to = pending.current;
      pending.current = null;
      navigate(to, { replace: true });
    }
  }, [location.key, location.pathname, type, navigate]);

  const backTo = useCallback(
    (pathname: string) => {
      const h = history.current;
      if (h.entries[h.at - 1]?.pathname !== pathname) return false;
      navigate(-1);
      return true;
    },
    [navigate],
  );
  const leaveTo = useCallback(
    (path: string) => {
      const depth = history.current.at;
      if (depth <= 0) {
        navigate(path, { replace: true });
        return;
      }
      pending.current = path;
      navigate(-depth);
    },
    [navigate],
  );
  return { backTo, leaveTo };
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

  const { backTo, leaveTo } = useImportHistory();

  const value = useMemo<ImportSessionValue>(
    () => ({ text, setText, read, commitRead, cards, setCards, updateCard, placeholderFor, handoff, setHandoff, saveRecord: saveRecord.current, backTo, leaveTo }),
    [text, read, commitRead, cards, updateCard, placeholderFor, handoff, backTo, leaveTo],
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
