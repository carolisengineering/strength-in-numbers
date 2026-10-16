import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionClock } from "./SessionClock";

const START = "2026-10-16T10:00:00.000Z";
let t = Date.parse(START);
const now = () => t;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => vi.useRealTimers());

describe("17.1 AC31 — the elapsed clock", () => {
  it("shows m:ss, switches to h:mm:ss at one hour, and updates once a second", () => {
    t = Date.parse(START) + 38 * 60_000 + 12_000;
    render(<SessionClock startedAt={START} now={now} />);
    expect(screen.getByText("38:12")).toBeInTheDocument();
    t += 1000;
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("38:13")).toBeInTheDocument();
    t = Date.parse(START) + 3600_000 + 5000;
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("1:00:05")).toBeInTheDocument();
  });

  it("clamps at 0:00 when the device clock is behind startedAt", () => {
    t = Date.parse(START) - 90_000;
    render(<SessionClock startedAt={START} now={now} />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("is not a live region", () => {
    t = Date.parse(START);
    const { container } = render(<SessionClock startedAt={START} now={now} />);
    expect(container.querySelector("[aria-live], [role='status'], [role='timer']")).toBeNull();
    expect(container).toHaveTextContent("Elapsed 0:00");
  });
});
