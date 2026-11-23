"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, ZIndexLayer, usePlotArea, useXAxisTicks, useYAxisScale
} from "recharts";
import {
  compactDashboardChartLabel, dashboardYearGroups, formatDashboardTooltipLabel,
  type DashboardChartSeries, type DashboardRenderPoint
} from "@/lib/dashboard-charts";
import { dashboardChartSeriesColor as color, DASHBOARD_CHART_STYLE as chartStyle } from "@/lib/dashboard-chart-style";
import styles from "./dashboard-chart-plot.module.css";

const numberLabel = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 });
const formatValue = (value: unknown, codes: string[]) => typeof value === "number" && Number.isFinite(value)
  ? codes[value - 1] ?? numberLabel.format(value) : "";

type PlotProps = {
  embedded?: boolean;
  chartType: "progression" | "comparison" | "average";
  title: string;
  chartData: DashboardRenderPoint[];
  chartSeries: DashboardChartSeries[];
  pieData: { name: string; value: number }[];
  scaleCodes: string[];
};

function YearBands({ points }: { points: DashboardRenderPoint[] }) {
  const area = usePlotArea();
  const ticks = useXAxisTicks();
  const groups = useMemo(() => dashboardYearGroups(points), [points]);
  if (!area || !ticks?.length) return null;
  const x = new Map(ticks.map(tick => [tick.value, tick.coordinate]));
  return <ZIndexLayer zIndex={-110}><g aria-hidden="true">
    {groups.map((group, index) => {
      const start = index === 0 ? area.x : x.get(group.firstAxisKey);
      const end = group.nextFirstAxisKey ? x.get(group.nextFirstAxisKey) : area.x + area.width;
      if (start == null || end == null) return null;
      return <g key={group.firstAxisKey} data-year-band={group.year}>
        <rect x={start} y={area.y} width={Math.max(0, end - start)} height={area.height} fill={chartStyle.yearBandColors[index % 2]} />
        {index > 0 && <line x1={start} x2={start} y1={area.y} y2={area.y + area.height} stroke={chartStyle.yearBoundaryColor} strokeWidth={1.5} />}
      </g>;
    })}
    {points.map((point, index) => {
      const prev = points[index - 1];
      if (prev && prev.year !== point.year) return null;
      if (!point.sectionStart && (!point.section || (prev?.section === point.section && prev.window === point.window))) return null;
      const boundary = x.get(point.axisKey);
      if (boundary == null) return null;
      return <line key={point.axisKey} data-section-boundary="" x1={boundary} x2={boundary} y1={area.y}
        y2={area.y + area.height} stroke="#bbc6cc" strokeDasharray="3 4">
        <title>{point.sectionStartLabel || point.section}</title>
      </line>;
    })}
  </g></ZIndexLayer>;
}

function PointLabels({ points, series, codes }: { points: DashboardRenderPoint[]; series: DashboardChartSeries[]; codes: string[] }) {
  const ticks = useXAxisTicks();
  const yScale = useYAxisScale();
  if (!ticks || !yScale) return null;
  const x = new Map(ticks.map(tick => [tick.value, tick.coordinate]));
  return <ZIndexLayer zIndex={2000}><g pointerEvents="none">
    {points.map(point => {
      const cx = x.get(point.axisKey);
      if (cx == null) return null;
      const labels = series.flatMap(({ id }, index) => {
        const value = point[id];
        if (typeof value !== "number" || !Number.isFinite(value)) return [];
        const cy = yScale(value);
        return typeof cy === "number" ? [{ id, index, value, cy }] : [];
      }).sort((a, b) => b.cy - a.cy);
      let previousY = Infinity;
      return <g key={point.axisKey}>{labels.map(({ id, index, value, cy }) => {
        // Stack close scores upward without dropping ties or obscuring the marks.
        const y = Math.min(cy - 9, previousY - 14);
        previousY = y;
        return <text key={id} data-point-value="" x={cx} y={y} textAnchor="middle" fill={color(index)}
          fontSize={chartStyle.valueFontSizePx} fontWeight={700} stroke="white" strokeWidth={3} paintOrder="stroke">{formatValue(value, codes)}</text>;
      })}</g>;
    })}
  </g></ZIndexLayer>;
}

export function DashboardChartPlot({ chartType, title, chartData, chartSeries, pieData, scaleCodes, embedded }: PlotProps) {
  const [fullScreen, setFullScreen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const plot = useRef<HTMLDivElement>(null);
  const pie = chartType === "average";
  const comparison = chartType === "comparison";
  const yearLabels = useMemo(() => new Map(dashboardYearGroups(chartData).map(g => [g.labelAxisKey, g.year])), [chartData]);
  const pointsByKey = useMemo(() => new Map(chartData.map(p => [p.axisKey, p])), [chartData]);
  const onlyZeroAverages = pie && pieData.length > 0 && pieData.every(p => p.value === 0);
  const populated = pie ? pieData.some(p => p.value > 0) : chartData.some(p => chartSeries.some(s => Number.isFinite(p[s.id])));
  const labels = pie ? pieData.map(p => p.name) : chartSeries.map(s => s.label);
  const spacing = comparison ? Math.max(100, chartSeries.length * 55) : 110;
  const edge = Math.max(50, Math.ceil(spacing / 2));
  // Students and sections can have disjoint data. Reserve label space only
  // for the series that actually have a score at the same tick.
  const top = useMemo(() => {
    if (comparison || pie) return 30;
    const concurrent = chartData.reduce((max, point) => Math.max(max,
      chartSeries.reduce((count, s) => count + Number(Number.isFinite(point[s.id])), 0)), 0);
    return 20 + 14 * concurrent;
  }, [chartData, chartSeries, comparison, pie]);
  const Chart = comparison ? BarChart : LineChart;
  const typeLabel = pie ? "Average" : comparison ? "Comparison" : "Progression";

  useEffect(() => {
    if (!fullScreen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setFullScreen(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [fullScreen]);

  async function download() {
    const svg = plot.current?.querySelector<SVGSVGElement>("svg.recharts-surface");
    if (!svg || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const { downloadDashboardChartPdf } = await import("@/lib/dashboard-charts-pdf");
      await downloadDashboardChartPdf(svg, title, labels.map((label, index) => ({ label, color: color(index) })));
    } catch {
      setExportError("The PDF could not be created. Please try again.");
    } finally { setExporting(false); }
  }

  return <section className={`panel chart-panel progression-chart-panel ${styles.panel} ${fullScreen ? `chart-panel-fullscreen ${styles.fullScreen}` : ""}`}>
    <div className={`panel-heading chart-panel-heading ${styles.heading}`}>
      <div><p className="eyebrow">{typeLabel}</p><h2>{title}</h2></div>
      {!embedded && <div className={styles.actions}>
        <button className="small-action ghost" disabled={!populated || exporting} onClick={download} type="button">
          {exporting ? "Creating PDF..." : "Download PDF"}
        </button>
        <button className="small-action ghost" aria-pressed={fullScreen} onClick={() => setFullScreen(v => !v)} type="button">
          {fullScreen ? "Exit full screen" : "Full screen"}
        </button>
      </div>}
    </div>
    {exportError && <p role="alert">{exportError}</p>}
    {populated ? <>
      <div className={styles.viewport} role="region" aria-label={`${title}, scrollable graph`} tabIndex={0}>
        <div ref={plot} className={styles.surface} style={{
          minWidth: pie ? 0 : 72 + edge * 2 + Math.max(0, chartData.length - 1) * spacing,
          minHeight: pie ? 315 : top + 295
        }}>
          <ResponsiveContainer width="100%" height="100%">
            {pie ? <PieChart>
              <Tooltip formatter={value => formatValue(value, scaleCodes)} />
              <Pie data={pieData} dataKey="value" nameKey="name" outerRadius="62%" isAnimationActive={false}
                label={props => formatValue(props.value, scaleCodes)}>
                {pieData.map((_, i) => <Cell key={i} fill={color(i)} />)}
              </Pie>
            </PieChart> : <Chart data={chartData} margin={{ top, left: 4, right: edge, bottom: 0 }}>
              <YearBands points={chartData} />
              <CartesianGrid vertical={false} stroke={chartStyle.gridColor} strokeDasharray={chartStyle.gridDashArray} />
              <XAxis dataKey="axisKey" interval={0} height={82} padding={{ left: edge, right: comparison ? 0 : 4 }}
                tick={({ x, y, payload }) => {
                  const point = pointsByKey.get(String(payload.value));
                  if (!point) return <g />;
                  const section = point.sectionLabel ?? point.section;
                  const window = point.windowLabel ?? point.window;
                  return <g transform={`translate(${x},${y})`} data-axis-tick={point.axisKey}>
                    <title>{formatDashboardTooltipLabel(point)}</title>
                    <text textAnchor="middle" fontSize={11} fill={chartStyle.axisTextColor}>
                      {section && <tspan x={0} y={point.sectionLine === 1 ? 20 : 9}>{compactDashboardChartLabel(section, 15)}</tspan>}
                      <tspan x={0} y={section ? 40 : 14} fontWeight={700}>{compactDashboardChartLabel(window, 15)}</tspan>
                      <tspan x={0} y={section ? 57 : 32} fill="#52616b">{yearLabels.get(point.axisKey)}</tspan>
                    </text>
                  </g>;
                }} />
              <YAxis width={64} allowDecimals={scaleCodes.length === 0}
                domain={scaleCodes.length ? [1, Math.max(2, scaleCodes.length)] : [comparison ? (min: number) => Math.min(0, min) : "auto", "auto"]}
                ticks={scaleCodes.length ? scaleCodes.map((_, i) => i + 1) : undefined}
                tickFormatter={v => formatValue(v, scaleCodes)} tick={{ fontSize: chartStyle.valueFontSizePx, fill: chartStyle.axisTextColor }} />
              <Tooltip formatter={value => formatValue(value, scaleCodes)}
                labelFormatter={(_, payload) => formatDashboardTooltipLabel(payload[0]?.payload)} />
              {chartSeries.map((s, i) => comparison
                ? <Bar key={s.id} name={s.label} dataKey={p => p[s.id]} fill={color(i)} isAnimationActive={false}
                    minPointSize={(_, index) => Number.isFinite(chartData[index]?.[s.id]) ? 1 : 0}>
                    <LabelList dataKey={p => p[s.id]} position="top" formatter={v => formatValue(v, scaleCodes)} fontSize={chartStyle.valueFontSizePx} fill={color(i)} />
                  </Bar>
                : <Line key={s.id} name={s.label} dataKey={p => p[s.id]} connectNulls type="linear" stroke={color(i)} strokeWidth={chartStyle.lineWidthPx}
                    dot={{ r: chartStyle.markerRadiusPx }} isAnimationActive={false} />)}
              {!comparison && <PointLabels points={chartData} series={chartSeries} codes={scaleCodes} />}
            </Chart>}
          </ResponsiveContainer>
        </div>
      </div>
      <ul className={styles.legend} aria-label="Chart legend">
        {labels.map((label, i) => <li key={i}><i aria-hidden="true" style={{ backgroundColor: color(i) }} />{label}</li>)}
      </ul>
    </> : <div className={`dashboard-chart-empty ${styles.empty}`}>{onlyZeroAverages
      ? "All selected averages are zero."
      : embedded
      ? "No values match both this saved chart and the selected report students and years."
      : "No values match the selected filters."}</div>}
  </section>;
}
