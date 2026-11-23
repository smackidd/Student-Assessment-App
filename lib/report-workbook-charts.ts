import * as XLSX from "xlsx-js-style";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import type { DashboardChartSeries, DashboardRenderPoint } from "./dashboard-charts";
import { add, chartPart, chartSheet, cleanText, drawingPart, emptyChartSheet, ns, root, type ChartTable } from "./report-workbook-chart-parts";

export interface ReportWorkbookChart {
  readonly id?: string;
  readonly chartType: "progression" | "comparison" | "average";
  readonly title: string;
  readonly chartData: readonly DashboardRenderPoint[];
  readonly chartSeries: readonly DashboardChartSeries[];
  readonly pieData: readonly { name: string; value: number }[];
  readonly scaleCodes: readonly string[];
}

function chartTable(chart: ReportWorkbookChart): ChartTable | undefined {
  const base = { type: chart.chartType, title: cleanText(chart.title) || "Chart", codes: chart.scaleCodes, seriesOffset: 0 };
  if (chart.chartType === "average") {
    const slices = chart.pieData.filter(p => Number.isFinite(p.value) && p.value >= 0);
    if (!slices.length) return;
    return { ...base, levels: [{ name: "Field", values: slices.map(p => p.name) }],
      series: [{ name: "Average", values: slices.map(p => p.value) }] };
  }
  const series = chart.chartSeries.map(({ id, label }) => ({
    name: label,
    values: chart.chartData.map(p => {
      const v = p[id];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    })
  }));
  if (!series.some(s => s.values.some(v => v !== null))) return;
  const points = chart.chartData, hasSections = points.some(p => p.section);
  const levels = [
    { name: "Year", values: points.map((p, i) => points[i - 1]?.year === p.year ? null : p.year) },
    { name: "Window", values: points.map((p, i) => {
      const previous = points[i - 1];
      const continued = hasSections && previous?.year === p.year && previous.window === p.window && !p.windowLabel;
      return continued ? null : p.windowLabel || p.window;
    }) }
  ];
  if (hasSections) levels.push({ name: "Section", values: points.map(p => p.section || null) });
  return { ...base, levels, series };
}

function* chartPages(charts: readonly ReportWorkbookChart[]) {
  const limit = 255; // Excel's maximum number of series per chart, not a cohort size limit.
  for (const chart of charts) {
    const table = chartTable(chart);
    const title = cleanText(chart.title) || "Chart";
    if (!table || table.series.length <= limit) {
      yield { title, suffix: "", table };
      continue;
    }
    for (let i = 0; i < table.series.length; i += limit) {
      const suffix = ` (${1 + i / limit} of ${Math.ceil(table.series.length / limit)})`;
      yield { title, suffix, table: { ...table, title: title + suffix, seriesOffset: i, series: table.series.slice(i, i + limit) } };
    }
  }
}

function sheetName(title: string, used: Set<string>, pageSuffix: string) {
  const base = title.replace(/[:\\/?*\[\]\x00-\x1f]/g, " ").replace(/^[\s']+|[\s']+$/g, "") || "Chart";
  for (let i = 1; ; i++) {
    const suffix = pageSuffix + (i === 1 ? "" : ` (${i})`);
    const name = base.slice(0, 31 - suffix.length).replace(/[\ud800-\udbff]$/, "").replace(/[\s']+$/, "") + suffix;
    const key = name.toLowerCase();
    if (!used.has(key) && key !== "history") { used.add(key); return name; }
  }
}

function relationship(parent: Element, id: string, kind: string, target: string) {
  add(parent, "Relationship", { Id: id, Type: ns.r + "/" + kind, Target: target });
}

function relationships(kind: string, target: string) {
  const rels = root(ns.rel, "Relationships");
  relationship(rels, "rId1", kind, target);
  return rels;
}

/** Serialize the styled report once. Only chart-specific parts and package indexes change. */
export async function writeReportWorkbookWithCharts(
  workbook: XLSX.WorkBook, charts: ReadonlyArray<ReportWorkbookChart>
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: !charts.length }));
  if (!charts.length) return bytes;

  // The package layout is that of the writer above, not an arbitrary uploaded ZIP.
  const files = unzipSync(bytes);
  const parser = new DOMParser({ onError: (_level, message) => { throw new Error(message); } });
  const serializer = new XMLSerializer();
  const read = (path: string) => parser.parseFromString(strFromU8(files[path]), "application/xml").documentElement!;
  const write = (path: string, element: Element) => { files[path] = strToU8(serializer.serializeToString(element)); };
  const bookPath = "xl/workbook.xml", relPath = "xl/_rels/workbook.xml.rels", typesPath = "[Content_Types].xml";
  const book = read(bookPath), bookRels = read(relPath), types = read(typesPath);
  const sheets = book.getElementsByTagNameNS(ns.s, "sheets")[0];
  const oldSheets = Array.from(sheets.getElementsByTagNameNS(ns.s, "sheet"));
  const names = new Set(oldSheets.map(s => s.getAttribute("name")!.toLowerCase()));
  let sheetId = oldSheets.reduce((max, s) => Math.max(max, Number(s.getAttribute("sheetId"))), 0);
  const takenRels = new Set(Array.from(bookRels.getElementsByTagNameNS(ns.rel, "Relationship"), r => r.getAttribute("Id")));
  let rid = 0, part = 0;
  const newNames: string[] = [];
  for (const { title, suffix, table } of chartPages(charts)) {
    const name = sheetName(title, names, suffix);
    newNames.push(name);
    // Reserve distinct sheet, drawing and chart paths, even if the base uses sparse numbering.
    do { part++; } while ([`xl/worksheets/sheet${part}.xml`, `xl/drawings/drawing${part}.xml`,
      `xl/charts/chart${part}.xml`, `xl/worksheets/_rels/sheet${part}.xml.rels`, `xl/drawings/_rels/drawing${part}.xml.rels`].some(p => p in files));
    do { rid++; } while (takenRels.has(`rId${rid}`));
    const sheet = `sheet${part}.xml`, drawing = `drawing${part}.xml`, chart = `chart${part}.xml`;
    add(sheets, "sheet", { name, sheetId: ++sheetId, "r:id": `rId${rid}` });
    relationship(bookRels, `rId${rid}`, "worksheet", "worksheets/" + sheet);
    const override = (path: string, content: string) => {
      add(types, "Override", { PartName: "/xl/" + path, ContentType: "application/vnd.openxmlformats-officedocument." + content + "+xml" });
    };
    override("worksheets/" + sheet, "spreadsheetml.worksheet");
    if (!table) {
      write("xl/worksheets/" + sheet, emptyChartSheet(title));
      continue;
    }
    override("drawings/" + drawing, "drawing");
    override("charts/" + chart, "drawingml.chart");
    write("xl/worksheets/" + sheet, chartSheet(table));
    write(`xl/worksheets/_rels/${sheet}.rels`, relationships("drawing", "../drawings/" + drawing));
    write("xl/drawings/" + drawing, drawingPart(table));
    write(`xl/drawings/_rels/${drawing}.rels`, relationships("chart", "../charts/" + chart));
    write("xl/charts/" + chart, chartPart(table, name));
  }
  write(bookPath, book); write(relPath, bookRels); write(typesPath, types);

  // SheetJS writes the worksheet list first in the extended-properties title vector.
  const propsPath = "docProps/app.xml";
  const props = read(propsPath);
  const heading = props.getElementsByTagNameNS(ns.ep, "HeadingPairs")[0];
  const titles = props.getElementsByTagNameNS(ns.ep, "TitlesOfParts")[0]?.getElementsByTagNameNS(ns.vt, "vector")[0];
  const count = heading?.getElementsByTagNameNS(ns.vt, "i4")[0];
  if (titles && count && heading.getElementsByTagNameNS(ns.vt, "lpstr")[0]?.textContent === "Worksheets") {
    const next = titles.getElementsByTagNameNS(ns.vt, "lpstr")[Number(count.textContent)] ?? null;
    for (const name of newNames) titles.insertBefore(add(titles, "vt:lpstr", {}, name), next);
    count.textContent = String(Number(count.textContent) + newNames.length);
    titles.setAttribute("size", String(Number(titles.getAttribute("size")) + newNames.length));
    write(propsPath, props);
  }
  return new Uint8Array(zipSync(files, { level: 6 }));
}
