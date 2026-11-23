import { spawnSync } from "node:child_process";
import { posix } from "node:path";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx-js-style";
import { dashboardChartSeriesColor } from "./dashboard-chart-style";
import { writeReportWorkbookWithCharts, type ReportWorkbookChart } from "./report-workbook-charts";

const book = () => {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Merged title"], ["Scores", 7], ["Total", { t: "n", v: 7, f: "B2" }]]);
  sheet.A1.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "243447" } } };
  sheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
  sheet["!cols"] = [{ wch: 32 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, sheet, "Report");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Original data"]]), "Scores");
  return wb;
};
const title = "O'Brien & <Peers>";
const seriesName = '=Score "R&D" <A>';
const line: ReportWorkbookChart = {
  id: "report-id", chartType: "progression", title,
  chartData: [
    { axisKey: "internal-id-1", year: "2025", window: "Fall & spring", section: "<East>", a: 0, b: 2, secret: 987654 },
    { axisKey: "internal-id-2", year: "2025", window: "Winter", section: "", a: null, b: -3.75 },
    { axisKey: "internal-id-3", year: "2026", window: "Spring", section: "", a: 4.5, b: Infinity }
  ],
  chartSeries: [{ id: "a", label: seriesName }, { id: "b", label: seriesName }],
  pieData: [{ name: "Not in line", value: 765432 }], scaleCodes: []
};
const bar: ReportWorkbookChart = { ...line, chartType: "comparison", title: "scores", scaleCodes: ["Low & <1>", "High"],
  chartSeries: [{ id: "a", label: "Scale" }], chartData: [{ ...line.chartData[0], a: 1 }, { ...line.chartData[1], a: 2 }] };
const pie: ReportWorkbookChart = { ...line, chartType: "average", title,
  pieData: [{ name: "A & <B>", value: 2.5 }, { name: "Same", value: 0 }, { name: "Same", value: 4 }] };
const empty: ReportWorkbookChart = { ...line, title: "Empty", chartData: [{ ...line.chartData[0], a: undefined, b: NaN }] };
const noValues = "No values match the selected filters.";

type Zip = ReturnType<typeof unzipSync>;
const elements = (el: Element, tag: string) => Array.from(el.getElementsByTagNameNS("*", tag));
const first = (el: Element, tag: string) => {
  const found = elements(el, tag)[0];
  expect(found, tag).toBeDefined();
  return found;
};
const attr = (e: Element, name: string) => e.getAttribute(name)!;
function xml(files: Zip, path: string) {
  return new DOMParser({ onError: (_level, msg) => { throw new Error(msg); } })
    .parseFromString(strFromU8(files[path]), "application/xml").documentElement!;
}
const relationNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function follow(files: Zip, path: string, source: Element, kind: string) {
  const rels = xml(files, posix.join(posix.dirname(path), "_rels", posix.basename(path) + ".rels"));
  const rel = elements(rels, "Relationship").find(r => attr(r, "Id") === source.getAttributeNS(relationNs, "id"))!;
  expect(attr(rel, "Type")).toBe(relationNs + "/" + kind);
  return posix.join(posix.dirname(path), attr(rel, "Target"));
}
function parts(files: Zip, name: string) {
  const bookPath = "xl/workbook.xml";
  const entry = elements(xml(files, bookPath), "sheet").find(s => attr(s, "name") === name)!;
  const sheetPath = follow(files, bookPath, entry, "worksheet");
  const sheet = xml(files, sheetPath);
  const drawingPath = follow(files, sheetPath, first(sheet, "drawing"), "drawing");
  const drawing = xml(files, drawingPath);
  expect(sheet.namespaceURI).toBe("http://schemas.openxmlformats.org/spreadsheetml/2006/main");
  expect(drawing.namespaceURI).toBe("http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing");
  expect(elements(drawing, "oneCellAnchor")).toHaveLength(1);
  expect(first(drawing, "chart").namespaceURI).toBe("http://schemas.openxmlformats.org/drawingml/2006/chart");
  const chartPath = follow(files, drawingPath, first(drawing, "chart"), "chart");
  const overrides = elements(xml(files, "[Content_Types].xml"), "Override");
  for (const [path, type] of [[sheetPath, "spreadsheetml.worksheet"], [drawingPath, "drawing"], [chartPath, "drawingml.chart"]]) {
    const matches = overrides.filter(o => attr(o, "PartName") === "/" + path);
    expect(matches).toHaveLength(1);
    expect(attr(matches[0], "ContentType")).toBe("application/vnd.openxmlformats-officedocument." + type + "+xml");
  }
  return { sheet, chart: xml(files, chartPath) };
}
const cached = (e: Element) => elements(e, "pt").map(pt => [attr(pt, "idx"), first(pt, "v").textContent]);
const names = (files: Zip) => elements(xml(files, "xl/workbook.xml"), "sheet").map(s => attr(s, "name"));
const cell = (s: Element, ref: string) => elements(s, "c").find(c => attr(c, "r") === ref);
const filesFor = async (...charts: ReportWorkbookChart[]) => unzipSync(await writeReportWorkbookWithCharts(book(), charts));

describe("native report workbook charts", () => {
  it("leaves the ordinary styled export alone for no selection and never mutates the source workbook", async () => {
    const wb = book();
    const baseline = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }));
    const original = unzipSync(baseline);
    const plain = unzipSync(await writeReportWorkbookWithCharts(wb, []));
    expect(plain).toEqual(original);
    const withCharts = unzipSync(await writeReportWorkbookWithCharts(wb, [line, empty, bar, pie]));
    for (const path of Object.keys(original).filter(k => !["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml", "docProps/app.xml"].includes(k))) {
      expect(withCharts[path], path).toEqual(original[path]);
    }
    expect(wb.SheetNames).toEqual(["Report", "Scores"]);
    expect(names(withCharts)).toEqual(["Report", "Scores", title, "Empty", "scores (2)", title + " (2)"]);
    const props = xml(withCharts, "docProps/app.xml");
    expect(elements(first(props, "TitlesOfParts"), "lpstr").map(n => n.textContent)).toEqual(names(withCharts));
    expect(first(props, "i4").textContent).toBe("6");
    expect(elements(xml(withCharts, "xl/worksheets/sheet1.xml"), "mergeCell")[0].getAttribute("ref")).toBe("A1:B1");
    expect(Object.keys(withCharts).filter(k => /^xl\/charts\/[^/]+\.xml$/.test(k))).toHaveLength(3);
  });

  it("links line series, literal names and category text to cells, including sparse, negative and zero values", async () => {
    const { chart, sheet } = parts(await filesFor(line), title);
    expect(first(first(chart, "title"), "t").textContent).toBe(title);
    const series = elements(first(chart, "lineChart"), "ser");
    expect(series).toHaveLength(2);
    const prefix = "'O''Brien & <Peers>'!";
    for (const [i, s] of series.entries()) {
      const column = ["D", "E"][i];
      expect(attr(first(s, "order"), "val")).toBe(String(i));
      expect(first(first(s, "tx"), "f").textContent).toBe(prefix + "$" + column + "$24");
      expect(cached(first(s, "tx"))).toEqual([["0", seriesName]]);
      expect(first(first(s, "cat"), "f").textContent).toBe(prefix + "$A$25:$C$27");
      expect(attr(first(first(s, "multiLvlStrCache"), "ptCount"), "val")).toBe("3");
      expect(elements(first(s, "multiLvlStrCache"), "lvl").map(cached)).toEqual([
        [["0", "<East>"]], [["0", "Fall & spring"], ["1", "Winter"], ["2", "Spring"]], [["0", "2025"], ["2", "2026"]]
      ]);
      expect(first(first(s, "val"), "f").textContent).toBe(prefix + "$" + column + "$25:$" + column + "$27");
      expect(attr(first(first(s, "numCache"), "ptCount"), "val")).toBe("3");
    }
    expect(cached(first(series[0], "val"))).toEqual([["0", "0"], ["2", "4.5"]]);
    expect(cached(first(series[1], "val"))).toEqual([["0", "2"], ["1", "-3.75"]]);
    expect(attr(first(chart, "dispBlanksAs"), "val")).toBe("span");
    expect(cell(sheet, "D24")?.textContent).toBe(seriesName);
    expect(elements(sheet, "f")).toHaveLength(0);
    expect(cell(sheet, "D25")?.textContent).toBe("0");
    expect(cell(sheet, "D26")).toBeUndefined();
    expect(cell(sheet, "E27")).toBeUndefined();
    expect(sheet.textContent + chart.textContent).not.toMatch(/internal-id|987654|765432|Not in line/);
  });

  it("writes clustered columns with linked axes and a scale key without converting scores to text", async () => {
    const { chart, sheet } = parts(await filesFor(bar), "scores (2)");
    const group = first(chart, "barChart"), cat = first(chart, "catAx"), val = first(chart, "valAx");
    expect(attr(first(group, "barDir"), "val")).toBe("col");
    expect(attr(first(group, "grouping"), "val")).toBe("clustered");
    expect(elements(group, "axId").map(n => attr(n, "val"))).toEqual([attr(first(cat, "axId"), "val"), attr(first(val, "axId"), "val")]);
    expect(attr(first(cat, "crossAx"), "val")).toBe(attr(first(val, "axId"), "val"));
    expect(attr(first(val, "crossAx"), "val")).toBe(attr(first(cat, "axId"), "val"));
    expect(["min", "max", "majorUnit"].map(k => attr(first(val, k), "val"))).toEqual(["1", "2", "1"]);
    expect(attr(first(val, "numFmt"), "formatCode")).toBe('[=1]"Low & <1>";[=2]"High";General');
    expect(cell(sheet, "G25")?.textContent).toBe("Low & <1>");
    expect(cell(sheet, "D25")?.getAttribute("t")).not.toBe("inlineStr");
    expect(first(cell(sheet, "I25")!, "f").textContent).toContain("INDEX($G$25:$G$26,D25)");
    expect(first(cell(sheet, "I25")!, "v").textContent).toBe("Low & <1>");
    expect(first(first(group, "dLbl"), "f").textContent).toBe("'scores (2)'!$I$25");
    expect(cached(first(group, "dLbl"))).toEqual([["0", "Low & <1>"]]);
    const outside = parts(await filesFor({ ...bar, chartData: line.chartData }), "scores (2)").chart;
    expect(elements(first(outside, "scaling"), "min")).toHaveLength(0);
    expect(elements(first(outside, "valAx"), "max")).toHaveLength(0);
  });

  it("builds a single pie series from pieData alone, preserving duplicate category names and zero slices", async () => {
    const { chart, sheet } = parts(await filesFor(pie), title);
    expect(elements(first(chart, "pieChart"), "ser")).toHaveLength(1);
    expect(elements(chart, "catAx")).toHaveLength(0);
    expect(elements(chart, "valAx")).toHaveLength(0);
    expect(cached(first(chart, "cat"))).toEqual([["0", "A & <B>"], ["1", "Same"], ["2", "Same"]]);
    expect(cached(first(chart, "val"))).toEqual([["0", "2.5"], ["1", "0"], ["2", "4"]]);
    expect(sheet.textContent + chart.textContent).not.toContain(seriesName);
  });

  it("uses preview colors, editable point labels, white circular line markers and dashed horizontal gridlines", async () => {
    const sample = await filesFor(line, bar, pie);
    const lineChart = parts(sample, title).chart, barChart = parts(sample, "scores (2)").chart;
    const pieChart = parts(sample, title + " (2)").chart;
    const rgb = (el: Element) => elements(el, "srgbClr").map(e => attr(e, "val"));
    for (const [i, s] of elements(lineChart, "ser").entries()) {
      const color = ["243447", "6751BF"][i];
      expect(rgb(first(s, "spPr"))).toEqual([color]);
      expect(attr(first(s, "ln"), "w")).toBe("23813");
      const marker = first(s, "marker");
      expect(["symbol", "size"].map(tag => attr(first(marker, tag), "val"))).toEqual(["circle", "6"]);
      expect(rgb(marker)).toEqual(["FFFFFF", color]);
      expect(rgb(first(s, "dLbls"))).toEqual([color]);
      expect(attr(first(first(s, "dLbls"), "showVal"), "val")).toBe("1");
      expect(attr(first(s, "dLblPos"), "val")).toBe("t");
    }
    expect(rgb(first(first(barChart, "ser"), "spPr"))).toEqual(["243447"]);
    expect(attr(first(barChart, "dLblPos"), "val")).toBe("outEnd");
    expect(attr(first(barChart, "dispBlanksAs"), "val")).toBe("gap");
    expect(elements(pieChart, "dPt").map(d => rgb(d)[0])).toEqual(["243447", "6751BF", "0F766E"]);
    expect(elements(pieChart, "dLbl").map(d => rgb(d)[0])).toEqual(["243447", "6751BF", "0F766E"]);
    for (const chart of [lineChart, barChart, pieChart]) {
      expect(attr(first(chart, "legendPos"), "val")).toBe("b");
      expect(attr(first(first(chart, "legend"), "overlay"), "val")).toBe("0");
    }
    for (const chart of [lineChart, barChart]) {
      for (const [tag, pos, size] of [["catAx", "low", "825"], ["valAx", "nextTo", "900"]]) {
        const axis = first(chart, tag);
        expect(attr(first(axis, "delete"), "val")).toBe("0");
        expect(attr(first(axis, "tickLblPos"), "val")).toBe(pos);
        expect(attr(first(first(axis, "txPr"), "defRPr"), "sz")).toBe(size);
      }
      expect(elements(first(chart, "catAx"), "majorGridlines")).toHaveLength(0);
      const grid = first(first(chart, "valAx"), "majorGridlines");
      expect(rgb(grid)).toEqual(["D4DCDF"]);
      expect(["d", "sp"].map(a => attr(first(grid, "ds"), a))).toEqual(["300000", "400000"]);
    }
  });

  it("groups sections inside windows inside years and shades actual year spans, not equal-width bands", async () => {
    const points = ["2024", "2024", "2024", "2025", "2026"].map((year, i) => ({
      year, section: i === 1 ? "Second" : "First", window: i === 2 ? "Spring" : "Fall",
      windowLabel: i === 1 ? "" : i === 2 ? "May" : "Oct", axisKey: String(i), a: i
    }));
    const files = await filesFor({ ...line, chartData: points }, { ...bar, chartData: points.slice(0, 3) },
      { ...line, title: "Windows", chartData: points.map(p => ({ ...p, section: "" })) });
    const { chart } = parts(files, title);
    expect(elements(first(chart, "multiLvlStrCache"), "lvl").map(cached)).toEqual([
      points.map((p, i) => [String(i), p.section]),
      [["0", "Oct"], ["2", "May"], ["3", "Oct"], ["4", "Oct"]],
      [["0", "2024"], ["3", "2025"], ["4", "2026"]]
    ]);
    const plotShape = (c: Element) => Array.from(first(c, "plotArea").childNodes)
      .find(node => node.nodeName === "c:spPr")! as Element;
    const stops = elements(plotShape(chart), "gs");
    const positions = stops.map(s => Number(attr(s, "pos")));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect((positions[1] + positions[3]) / 2).toBe(70000);
    expect((positions[5] + positions[7]) / 2).toBe(90000);
    expect(stops.map(s => attr(first(s, "srgbClr"), "val"))).toEqual([
      "F0F7F4", "F0F7F4", "88939C", "88939C", "F4F2FB", "F4F2FB", "88939C", "88939C", "F0F7F4", "F0F7F4"
    ]);
    expect(attr(first(plotShape(parts(files, "scores (2)").chart), "srgbClr"), "val")).toBe("F0F7F4");
    expect(elements(first(parts(files, "Windows").chart, "multiLvlStrCache"), "lvl")).toHaveLength(2);
  });

  it("splits oversized cohorts into editable charts without dropping or recoloring a series", async () => {
    const all = Array.from({ length: 256 }, (_, i) => ({ id: String(i), label: "Series " + i }));
    const point = { ...line.chartData[0], ...Object.fromEntries(all.map((s, i) => [s.id, i])) };
    const title = "Long synthetic title needing truncation";
    const make = (length: number) => ({ ...line, title, chartData: [point], chartSeries: all.slice(0, length) });
    const files = await filesFor(make(255), make(256));
    const tabs = names(files).slice(2);
    expect(tabs).toHaveLength(3);
    expect(tabs[1]).toMatch(/ \(1 of 2\)$/);
    expect(tabs[2]).toMatch(/ \(2 of 2\)$/);
    const pages = tabs.slice(1).map(tab => elements(parts(files, tab).chart, "ser"));
    expect(pages.map(p => p.length)).toEqual([255, 1]);
    const series = pages.flat();
    expect(series.map(s => cached(first(s, "tx"))[0][1])).toEqual(all.map(s => s.label));
    expect(series.map(s => cached(first(s, "val"))[0][1])).toEqual(all.map(s => s.id));
    const colors = series.map(s => "#" + attr(first(first(s, "spPr"), "srgbClr"), "val").toLowerCase());
    expect(colors).toEqual(all.map((_, i) => dashboardChartSeriesColor(i)));
    expect(new Set(colors).size).toBe(256);
  }, 30000);

  it("keeps an all-zero pie editable and an empty pie chart-free in the same workbook", async () => {
    const zero = { ...pie, title: "Zero averages", pieData: [{ name: "Recall", value: 0 }, { name: "Transfer", value: 0 }] };
    const files = await filesFor(zero, { ...pie, title: "No averages", pieData: [] });
    const { chart, sheet } = parts(files, zero.title);
    const series = first(first(chart, "pieChart"), "ser");
    expect(cached(first(series, "cat"))).toEqual([["0", "Recall"], ["1", "Transfer"]]);
    expect(cached(first(series, "val"))).toEqual([["0", "0"], ["1", "0"]]);
    expect(first(first(series, "val"), "f").textContent).toBe("'Zero averages'!$B$25:$B$26");
    expect(["B25", "B26"].map(ref => first(cell(sheet, ref)!, "v").textContent)).toEqual(["0", "0"]);
    const emptySheet = xml(files, "xl/worksheets/sheet4.xml");
    expect(emptySheet.textContent).toContain(noValues);
    expect(elements(emptySheet, "drawing")).toHaveLength(0);
  });

  it("retains a zero-only series and never reads unselected fields or the other plot type's data", async () => {
    const unused = () => { throw new Error("Unrelated plot data was read"); };
    const point = { ...line.chartData[0], a: 0, get unrelated() { return unused(); } };
    const zero = { ...line, chartSeries: [{ id: "a", label: "Zero" }], chartData: [point], get pieData() { return unused(); } };
    const pieOnly = { ...pie, title: "Pie", get chartData() { return unused(); }, get chartSeries() { return unused(); } };
    const files = await filesFor(zero, pieOnly);
    expect(cached(first(parts(files, title).chart, "val"))).toEqual([["0", "0"]]);
    expect(elements(parts(files, "Pie").chart, "pieChart")).toHaveLength(1);
  });

  it("preserves every selected empty chart, in order, without relationships, sources or invented scores", async () => {
    const files = await filesFor(empty, { ...empty, title: "Empty", chartType: "average", pieData: [] });
    expect(names(files)).toEqual(["Report", "Scores", "Empty", "Empty (2)"]);
    expect(Object.keys(files).filter(k => /^xl\/(drawings|charts)\//.test(k))).toEqual([]);
    for (const n of [3, 4]) {
      const sheet = xml(files, "xl/worksheets/sheet" + n + ".xml");
      expect(sheet.textContent).toContain(noValues);
      expect(elements(sheet, "drawing")).toHaveLength(0);
      expect(elements(sheet, "v")).toHaveLength(0);
      expect(files["xl/worksheets/_rels/sheet" + n + ".xml.rels"]).toBeUndefined();
    }
    const mixed = await filesFor(empty, line, { ...empty, title: "End" });
    expect(names(mixed)).toEqual(["Report", "Scores", "Empty", title, "End"]);
    expect(xml(mixed, "xl/worksheets/sheet5.xml").textContent).toContain(noValues);
    expect(elements(parts(mixed, title).chart, "lineChart")).toHaveLength(1);
  });

  it("assigns legal unique tab names without changing chart titles; supports columns beyond Z", async () => {
    const bad = "'M/?e:*[t]\\rics with a very long suffix \ud83d\ude00'";
    const charts = [bad, bad, "HISTORY", "report", "'   '", "X".repeat(30) + "\ud83d\ude00"].map(title => ({ ...line, title }));
    const extended = { ...line, title: "Wide", chartSeries: Array.from({ length: 27 }, (_, i) => ({ id: "a", label: String(i) })) };
    const files = await filesFor(...charts, extended);
    const tabs = names(files).slice(2);
    expect(new Set(tabs.map(s => s.toLowerCase())).size).toBe(tabs.length);
    for (const tab of tabs) {
      expect(tab.length).toBeLessThanOrEqual(31);
      expect(tab).not.toMatch(/[:\\/?*\[\]]|^'|'$|^history$/i);
    }
    expect(first(first(parts(files, tabs[0]).chart, "title"), "t").textContent).toBe(bad);
    expect(tabs.slice(2, 6)).toEqual(["HISTORY (2)", "report (2)", "Chart", "X".repeat(30)]);
    const wide = parts(files, "Wide");
    expect(cell(wide.sheet, "AD29")?.textContent).toBe("26");
    expect(first(first(elements(wide.chart, "ser")[26], "val"), "f").textContent).toBe("'Wide'!$AD$30:$AD$32");
  });

  // Set OPENPYXL_PYTHON to a Python interpreter with openpyxl for the independent reader check.
  it.skipIf(!process.env.OPENPYXL_PYTHON)("openpyxl distinguishes zero averages with numeric backing cells from no averages", async () => {
    const bytes = await writeReportWorkbookWithCharts(book(), [
      { ...pie, title: "Measured", pieData: [{ name: "Recall", value: 0 }, { name: "Transfer", value: 0 }] },
      { ...pie, title: "Unmeasured", pieData: [] }
    ]);
    const check = [
      "import io, sys, openpyxl",
      "from openpyxl.chart import PieChart",
      "wb = openpyxl.load_workbook(io.BytesIO(sys.stdin.buffer.read()))",
      "measured, empty = wb['Measured'], wb['Unmeasured']",
      "chart, = measured._charts",
      "assert isinstance(chart, PieChart)",
      "series, = chart.series",
      "for ref, cache, expected in [(series.cat.strRef, series.cat.strRef.strCache, ['Recall', 'Transfer']), (series.val.numRef, series.val.numRef.numCache, [0, 0])]:",
      "    tab, address = ref.f.rsplit('!', 1)",
      "    assert tab == \"'Measured'\"",
      "    cells = [c for row in measured[address] for c in row]",
      "    assert [c.value for c in cells] == expected",
      "    assert cache.ptCount == 2 and [(p.idx, p.v) for p in cache.pt] == list(enumerate(expected))",
      "    if ref is series.val.numRef: assert all(c.data_type == 'n' for c in cells)",
      "assert not empty._charts and empty['A2'].value == 'No values match the selected filters.'"
    ].join("\n");
    const result = spawnSync(process.env.OPENPYXL_PYTHON!, ["-W", "error", "-c", check], { input: bytes, encoding: "utf8", timeout: 25000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  }, 30000);

  it.skipIf(!process.env.OPENPYXL_PYTHON)("opens all three native chart classes, the empty sheet and the styled report in openpyxl", async () => {
    const bytes = await writeReportWorkbookWithCharts(book(), [line, empty, bar, pie]);
    const check = [
      "import sys, tempfile, warnings, openpyxl",
      "from pathlib import Path",
      "from openpyxl.chart import LineChart, BarChart, PieChart",
      "warnings.simplefilter('error')",
      "with tempfile.TemporaryDirectory() as tmp:",
      "    path = Path(tmp) / 'synthetic-student-report.xlsx'",
      "    path.write_bytes(sys.stdin.buffer.read())",
      "    wb = openpyxl.load_workbook(path)",
      "    cached = openpyxl.load_workbook(path, data_only=True)",
      "report, original, line, empty, bar, pie = wb.worksheets",
      "assert original['A1'].value == 'Original data'",
      "assert 'A1:B1' in report.merged_cells and report['A1'].font.bold and report['B3'].value == '=B2'",
      "assert not empty._charts and empty['A2'].value == 'No values match the selected filters.'",
      "assert line['D25'].value == 0 and line['D26'].value is None and line['D24'].data_type == 's'",
      "for sheet, cls in [(line, LineChart), (bar, BarChart), (pie, PieChart)]:",
      "    assert len(sheet._charts) == 1 and isinstance(sheet._charts[0], cls)",
      "    chart = sheet._charts[0]",
      "    for s in chart.series:",
      "        for ref in filter(None, [s.tx.strRef, s.cat.strRef, s.val.numRef]):",
      "            tab, address = ref.f.rsplit('!', 1)",
      "            assert tab[1:-1].replace(chr(39)*2, chr(39)) == sheet.title",
      "            cells = sheet[address.replace('$', '')]",
      "            actual = [c.value for row in cells for c in row] if isinstance(cells, tuple) else [cells.value]",
      "            cache = getattr(ref, 'strCache', None) or ref.numCache",
      "            assert cache.ptCount == len(actual)",
      "            assert {p.idx: p.v for p in cache.pt} == {i: v for i,v in enumerate(actual) if v is not None}",
      "        if s.cat.multiLvlStrRef:",
      "            ref = s.cat.multiLvlStrRef",
      "            tab, address = ref.f.rsplit('!', 1)",
      "            assert tab[1:-1].replace(chr(39)*2, chr(39)) == sheet.title",
      "            rows = sheet[address]",
      // openpyxl 3.1.5 models this cache's ptCount as an XML attribute, not the OOXML child.
      // Validate the actual level indexes against source cells here; the package test checks ptCount.
      "            levels = ref.multiLvlStrCache.lvl",
      "            assert len(levels) == len(rows[0])",
      "            for level, column in zip(levels, reversed(list(zip(*rows)))):",
      "                assert {p.idx:p.v for p in level.pt} == {i:c.value for i,c in enumerate(column) if c.value is not None}",
      "assert [c.legend.position for c in (line._charts[0], bar._charts[0], pie._charts[0])] == ['b']*3",
      "assert len(line._charts[0].series) == 2 and line._charts[0].display_blanks == 'span'",
      "for ch in (line._charts[0], bar._charts[0]):",
      "    assert ch.x_axis.delete is False and ch.y_axis.delete is False",
      "    assert ch.x_axis.tickLblPos == 'low' and ch.y_axis.tickLblPos == 'nextTo'",
      "s = line._charts[0].series[1]",
      "assert s.graphicalProperties.line.solidFill.srgbClr == '6751BF' and s.graphicalProperties.line.w == 23813",
      "assert s.marker.symbol == 'circle' and s.marker.size == 6 and s.marker.spPr.solidFill.srgbClr == 'FFFFFF'",
      "assert s.dLbls.showVal and s.dLbls.dLblPos == 't'",
      "assert bar._charts[0].y_axis.majorUnit == 1 and bar._charts[0].display_blanks == 'gap'",
      "assert bar._charts[0].series[0].spPr.solidFill.srgbClr == '243447' and bar['I25'].data_type == 'f'",
      "assert cached[bar.title]['I25'].value == 'Low & <1>'",
      "assert [p.spPr.solidFill.srgbClr for p in pie._charts[0].series[0].dPt] == ['243447','6751BF','0F766E']",
      "print(openpyxl.__version__, 'LineChart BarChart PieChart')"
    ].join("\n");
    const result = spawnSync(process.env.OPENPYXL_PYTHON!, ["-c", check], { input: bytes, encoding: "utf8", timeout: 25000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("LineChart BarChart PieChart");
  }, 30000);
});
