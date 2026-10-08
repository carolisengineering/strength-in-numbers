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
