import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as copy from "./finishMessages";
import * as messages from "../messages";

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "finishMessages.ts"), "utf8");

describe("06.7 AC33 — the offline-finish copy is static and in one file", () => {
  it("every constant is the §6.10 text, verbatim", () => {
    expect(copy.SAVED_OFFLINE).toBe(
      "Workout saved on this phone. There's no signal, so it isn't in the cloud yet. It sends when the app is open and you have signal. If you close the app, it might not reopen until you have signal, but your workout stays safe on this phone. Personal records will show after it sends.",
    );
    expect(copy.SAVED_SLOW).toBe(
      "Workout saved on this phone. Your signal is weak, so it isn't in the cloud yet. It keeps trying while the app is open. If you close the app, it sends the next time you open it with signal. Personal records will show after it sends.",
    );
    expect(copy.NOT_DURABLE).toBe(
      "Your workout hasn't sent yet, and this phone couldn't save it. Keep this page open until it sends. If you close the page, the workout will be lost.",
    );
    expect(copy.SENT).toBe("Sent to the cloud.");
    expect(copy.SAVED_ELSEWHERE).toBe(
      "Your workout is saved. It had already been finished on another device, so this phone's end time wasn't used.",
    );
    expect(copy.EDIT_AFTER_SEND).toBe("You can edit this workout after it sends.");
    expect(copy.START_BLOCKED_MESSAGE).toBe("Your last workout hasn't sent yet. You can start a new one after it does.");
    expect(copy.WAITING_OFFLINE).toBe("No signal. It sends when the app is open and you have signal.");
    expect(copy.WAITING_ONLINE).toBe("Sending…");
    expect(copy.KEEP_OPEN).toBe("Keep this page open.");
    expect(copy.FINISH_OFFLINE_NOTE).toBe(
      "No signal. Finish saves this workout on your phone, and it sends when you're back online with the app open.",
    );
    expect(copy.REFUSED_LEAD).toBe("Your workout is still open — it couldn't be finished.");
    expect(copy.REFUSED_OTHER).toBe("The server refused it. Check your workout, then tap Finish again.");
    expect(copy.GONE_TITLE).toBe("This workout couldn't be saved");
    expect(copy.GONE_BODY).toBe("It was deleted on another device.");
    expect(copy.GONE_DISCARD).toBe("Discard from this phone");
    expect(copy.GONE_CONFIRM).toBe("Discard this workout from this phone? This can't be undone.");
  });

  it("the counted lines read as §6.10 says, singular and plural", () => {
    expect(copy.waitingTitle(1)).toBe("1 workout waiting to send");
    expect(copy.waitingTitle(2)).toBe("2 workouts waiting to send");
    expect(copy.finishUnsentNote(1)).toBe("1 set hasn't sent yet. It sends first.");
    expect(copy.finishUnsentNote(3)).toBe("3 sets haven't sent yet. They send first.");
    expect(copy.landedLine(2)).toBe("Your workout saved: new records on 2 lifts");
    expect(copy.landedLine(1)).toBe("Your workout saved: a new record");
    expect(copy.landedLine(0)).toBe("Your workout saved.");
    expect(copy.landedLine(null)).toBe("Your workout saved.");
    expect(copy.refusedBlocked(1)).toBe("1 set couldn't be saved. Fix or discard it, then tap Finish again.");
    expect(copy.refusedBlocked(2)).toBe("2 sets couldn't be saved. Fix or discard them, then tap Finish again.");
    expect(copy.refusedIncomplete(1)).toBe("1 working set is missing data. Fix or delete it, then tap Finish again.");
    expect(copy.refusedIncomplete(2)).toBe("2 working sets are missing data. Fix or delete them, then tap Finish again.");
    expect(copy.finishLocked(1)).toBe("1 thing couldn't be saved — fix it first");
    expect(copy.finishLocked(2)).toBe("2 things couldn't be saved — fix them first");
  });

  it("only integer parameters are interpolated, and every function takes one number", () => {
    // Every `${…}` in the file names a parameter typed `number` (or `number | null`): no value, name, id or time.
    const params = new Set([...SOURCE.matchAll(/\((\w+): number(?: \| null)?\)/g)].map((m) => m[1]));
    const interpolated = [...SOURCE.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]!.trim());
    expect(interpolated.length).toBeGreaterThan(0);
    for (const expression of interpolated) expect(params, expression).toContain(expression);
    for (const [name, value] of Object.entries(copy)) {
      if (typeof value === "function") expect(value.length, name).toBe(1);
      else expect(typeof value, name).toBe("string");
    }
  });

  it("is re-exported from messages.ts, the workouts copy file", () => {
    for (const name of Object.keys(copy)) expect((messages as Record<string, unknown>)[name], name).toBe((copy as Record<string, unknown>)[name]);
  });

  it("uses American spelling and plain words", () => {
    expect(SOURCE).not.toMatch(/colour|cancelled|behaviour|favourite|organis|centre|grey/i);
    expect(SOURCE).not.toMatch(/dummy|purge|sync(ed|ing)?\b/i);
  });
});
