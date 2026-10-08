import type { ChartPoint } from "./metrics";
import { VIEW, hitAreas, layoutChart, xLabels } from "./scale";
import styles from "./LineChart.module.css";

const TICK = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export interface LineChartProps {
  points: readonly ChartPoint[];
  /** Reps: integer ticks. */
  integer?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The accessible name — the chart is one image to assistive tech; the sessions list is the detail (D5). */
  summary: string;
}

/** One series, drawn in a fixed 360 × 220 viewBox that scales with its container (Spec 08.1 AC16, D1/D2). */
export function LineChart({ points, integer = false, selectedId, onSelect, summary }: LineChartProps) {
  const layout = layoutChart(points, { integer });
  const right = VIEW.width - VIEW.right;
  return (
    <svg className={styles.chart} viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} width="100%" role="img" aria-label={summary}>
      {layout.ticks.map((t) => (
        <g key={t.value}>
          <line className={styles.grid} x1={VIEW.left} x2={right} y1={t.y} y2={t.y} />
          <text className={styles.tick} x={VIEW.left - 6} y={t.y} textAnchor="end" dominantBaseline="middle">
            {TICK.format(t.value)}
          </text>
        </g>
      ))}
      {xLabels(layout).map((l) => (
        <text key={`${l.x}:${l.text}`} className={styles.xLabel} x={l.x} y={VIEW.height - 8} textAnchor="middle">
          {l.text}
        </text>
      ))}
      {layout.points.length > 1 ? (
        <polyline className={styles.line} points={layout.points.map((p) => `${p.x},${p.py}`).join(" ")} />
      ) : null}
      {layout.points.map((p) => {
        const selected = p.id === selectedId;
        return (
          <circle
            key={p.id}
            data-testid="chart-dot"
            data-selected={selected ? "true" : undefined}
            className={selected ? `${styles.dot} ${styles.selected}` : styles.dot}
            cx={p.x}
            cy={p.py}
            r={selected ? 6 : 4}
          />
        );
      })}
      {hitAreas(layout).map((a) => (
        <rect
          key={`hit:${a.id}`}
          data-testid="chart-hit"
          className={styles.hit}
          x={a.x}
          y={a.y}
          width={a.width}
          height={a.height}
          onClick={() => onSelect(a.id)}
        />
      ))}
    </svg>
  );
}
