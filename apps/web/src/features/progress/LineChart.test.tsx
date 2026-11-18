import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LineChart } from "./LineChart";
import type { ChartPoint } from "./metrics";
import { hitAreas, layoutChart } from "./scale";

const pts: ChartPoint[] = [
  { id: "w1", localDate: "2026-08-01", canonical: 105, y: 105 },
  { id: "w2", localDate: "2026-09-01", canonical: 115, y: 115 },
  { id: "w3", localDate: "2026-10-01", canonical: 122.5, y: 122.5 },
];

function renderChart(points = pts, selectedId: string | null = "w3") {
  const onSelect = vi.fn();
  const { container } = render(<LineChart points={points} selectedId={selectedId} onSelect={onSelect} summary="Est. 1RM, 3 months: …" />);
  return { container, onSelect };
}

describe("08.1 AC16 — the chart", () => {
  it("one svg role=img named by the summary; a polyline; a dot and a hit area per point", () => {
    const { container } = renderChart();
    const svg = screen.getByRole("img", { name: "Est. 1RM, 3 months: …" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 360 220");
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
    expect(screen.getAllByTestId("chart-dot")).toHaveLength(3);
    expect(screen.getAllByTestId("chart-hit")).toHaveLength(3);
  });

  it("17.13 final review I1 — date labels take the anchor xLabels gives them", () => {
    const { container } = renderChart([
      { id: "a", localDate: "2025-12-20", canonical: 1, y: 1 },
      { id: "b", localDate: "2026-01-10", canonical: 2, y: 2 },
    ]);
    const labels = [...container.querySelectorAll("text")].filter((t) => /20\d\d/.test(t.textContent ?? ""));
    expect(labels.map((t) => [t.textContent, t.getAttribute("text-anchor")])).toEqual([
      ["Dec 20, 2025", "start"],
      ["Jan 10, 2026", "end"],
    ]);
  });

  it("tick labels come from niceTicks, values only", () => {
    const { container } = renderChart();
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    for (const v of layoutChart(pts).ticks.map((t) => String(t.value))) expect(texts).toContain(v);
    expect(texts.join(" ")).not.toMatch(/kg|lb/);
  });

  it("a single point: a lone dot, no polyline", () => {
    const { container } = renderChart([pts[0]!], "w1");
    expect(container.querySelectorAll("polyline")).toHaveLength(0);
    expect(screen.getAllByTestId("chart-dot")).toHaveLength(1);
  });

  it("the selected dot is marked; clicking a hit area selects its point", () => {
    const { onSelect } = renderChart();
    const dots = screen.getAllByTestId("chart-dot");
    expect(dots.filter((d) => d.getAttribute("data-selected") === "true")).toHaveLength(1);
    expect(dots[2]!.getAttribute("data-selected")).toBe("true");
    fireEvent.click(screen.getAllByTestId("chart-hit")[0]!);
    expect(onSelect).toHaveBeenCalledWith("w1");
  });

  it("hit areas are the rects from hitAreas; nothing inside the svg is focusable", () => {
    const { container } = renderChart();
    const hits = screen.getAllByTestId("chart-hit");
    expect(hits.map((h) => h.tagName.toLowerCase())).toEqual(["rect", "rect", "rect"]);
    hitAreas(layoutChart(pts)).forEach((a, i) => {
      for (const k of ["x", "y", "width", "height"] as const) expect(hits[i]!.getAttribute(k)).toBe(String(a[k]));
    });
    expect(container.querySelectorAll("svg [tabindex], svg a, svg button")).toHaveLength(0);
  });
});

describe("17.12 AC23 — the chart draws at its own width", () => {
  const svgOf = (container: HTMLElement) => container.querySelector("svg")!;

  it("with nothing to measure it (jsdom) the viewBox is today's 360 × 220", () => {
    const { container } = renderChart();
    expect(svgOf(container).getAttribute("viewBox")).toBe("0 0 360 220");
  });

  it("at 800 wide: an 800 × 320 viewBox, the last dot at 800 − 16, grid lines to the right margin, hit areas over 0..800", () => {
    const { container } = render(<LineChart points={pts} selectedId="w3" onSelect={vi.fn()} summary="s" width={800} />);
    expect(svgOf(container).getAttribute("viewBox")).toBe("0 0 800 320");
    expect(screen.getAllByTestId("chart-dot").at(-1)!.getAttribute("cx")).toBe("784");
    const grid = [...container.querySelectorAll("line")];
    expect(grid.length).toBeGreaterThan(0);
    for (const l of grid) expect([l.getAttribute("x1"), l.getAttribute("x2")]).toEqual(["48", "784"]);
    const hits = screen.getAllByTestId("chart-hit");
    expect(hits[0]!.getAttribute("x")).toBe("0");
    const last = hits.at(-1)!;
    expect(Number(last.getAttribute("x")) + Number(last.getAttribute("width"))).toBe(800);
    for (const h of hits) expect(h.getAttribute("height")).toBe("320");
  });

  it("the svg sits in its own box, which is the thing measured", () => {
    const { container } = renderChart();
    const box = svgOf(container).parentElement!;
    expect(box).not.toBe(container);
    expect(box.tagName.toLowerCase()).toBe("div");
  });
});
