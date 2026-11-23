import { DOMImplementation, type Element } from "@xmldom/xmldom";
import { DASHBOARD_CHART_STYLE as style, dashboardChartSeriesColor } from "./dashboard-chart-style";

const office = "http://schemas.openxmlformats.org/";
export const ns = {
  s: office + "spreadsheetml/2006/main",
  c: office + "drawingml/2006/chart",
  a: office + "drawingml/2006/main",
  xdr: office + "drawingml/2006/spreadsheetDrawing",
  r: office + "officeDocument/2006/relationships",
  rel: office + "package/2006/relationships",
  ep: office + "officeDocument/2006/extended-properties",
  vt: office + "officeDocument/2006/docPropsVTypes",
  xml: "http://www.w3.org/XML/1998/namespace"
};

export type ChartTable = {
  type: "progression" | "comparison" | "average";
  title: string;
  levels: { name: string; values: (string | null)[] }[]; // Worksheet order: outermost to innermost.
  seriesOffset: number;
  series: { name: string; values: (number | null)[] }[];
  codes: readonly string[];
};

// XML 1.0 does not allow control characters or isolated UTF-16 surrogates.
export const cleanText = (value: string) => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]/gu, "\ufffd");

export const root = (uri: string, name: string) => new DOMImplementation().createDocument(uri, name, null).documentElement!;
type Attrs = Record<string, string | number>;
const uriOf = (name: string) => ns[name.split(":")[0] as keyof typeof ns];

export function add(parent: Element, name: string, attrs: Attrs = {}, text?: string | number) {
  const doc = parent.ownerDocument!;
  const node = doc.createElementNS(name.includes(":") ? uriOf(name) : parent.namespaceURI, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.includes(":")) node.setAttributeNS(uriOf(k), k, cleanText(String(v)));
    else node.setAttribute(k, cleanText(String(v)));
  }
  if (text !== undefined) node.appendChild(doc.createTextNode(cleanText(String(text))));
  parent.appendChild(node);
  return node;
}

function layout(table: ChartTable) {
  const count = table.levels[0].values.length, pie = table.type === "average";
  const legendCount = pie ? count : table.series.length;
  const height = Math.min(2000, 400 + Math.max(0, Math.ceil(legendCount / 4) - 3) * 24);
  const width = pie ? 880 : Math.min(4000, Math.max(880, 160 + count * (table.type === "comparison" ? Math.max(100, table.series.length * 55) : 110)));
  // Default rows are 15 pt (20 px). Leave three clear rows below the native drawing.
  const header = Math.ceil(height / 20) + 4, first = header + 1;
  const valueCol = table.levels.length + 1, keyCol = valueCol + table.series.length + 1;
  return { width, height, header, first, count, valueCol, keyCol, labelCol: keyCol + 3 };
}
function col(n: number) {
  let label = "";
  while (n > 0) { n--; label = String.fromCharCode(65 + n % 26) + label; n = Math.floor(n / 26); }
  return label;
}

export function chartSheet(table: ChartTable) {
  const { levels, series, codes } = table;
  const { header, first, count, valueCol, keyCol, labelCol } = layout(table);
  if (series.length > 255 || Math.max(count, codes.length) + header > 1048576) {
    throw new RangeError("This chart exceeds Excel's series or worksheet row limit.");
  }
  const sheet = root(ns.s, "worksheet");
  add(sheet, "sheetFormatPr", { defaultRowHeight: 15 });
  const cols = add(sheet, "cols");
  const width = (min: number, max: number, w: number) => add(cols, "col", { min, max, width: w, customWidth: 1 });
  width(1, levels.length, 24);
  width(valueCol, valueCol + series.length - 1, 24);
  if (codes.length) {
    width(keyCol, keyCol + 1, 18);
    width(labelCol, labelCol + series.length - 1, 24);
  }
  const rows = add(sheet, "sheetData");
  for (let i = -1; i < Math.max(count, codes.length); i++) {
    const r = first + i, row = add(rows, "row", { r });
    const cell = (column: number, v: string | number | null) => {
      if (v === null) return;
      const ref = col(column) + r;
      if (typeof v === "number") add(add(row, "c", { r: ref }), "v", {}, v);
      else add(add(add(row, "c", { r: ref, t: "inlineStr" }), "is"), "t", { "xml:space": "preserve" }, v);
    };
    if (i < count) {
      levels.forEach((level, j) => cell(j + 1, i === -1 ? level.name : level.values[i]));
      series.forEach((s, j) => cell(j + valueCol, i === -1 ? s.name : s.values[i]));
    }
    if (codes.length && i < codes.length) {
      cell(keyCol, i === -1 ? "Score" : i + 1);
      cell(keyCol + 1, i === -1 ? "Scale label" : codes[i]);
    }
    // Native point labels reference these formulas: editing a numeric score or the
    // scale key updates its label without turning the plotted value into text.
    if (codes.length && i < count) series.forEach((s, j) => {
      if (i === -1) { cell(labelCol + j, s.name + " (label)"); return; }
      const source = col(valueCol + j) + r, key = "$" + col(keyCol + 1) + "$";
      const v = s.values[i], label = v === null ? "" : codes[v - 1] ?? v;
      const output = add(row, "c", { r: col(labelCol + j) + r, t: typeof label === "number" ? "n" : "str" });
      add(output, "f", {}, `IF(ISNUMBER(${source}),IF(AND(${source}=INT(${source}),${source}>=1,${source}<=${codes.length}),INDEX(${key}${first}:${key}${first + codes.length - 1},${source}),${source}),"")`);
      add(output, "v", {}, label);
    });
  }
  add(sheet, "drawing", { "r:id": "rId1" });
  return sheet;
}

export function emptyChartSheet(title: string) {
  const sheet = root(ns.s, "worksheet");
  add(add(sheet, "cols"), "col", { min: 1, max: 1, width: 65, customWidth: 1 });
  const data = add(sheet, "sheetData");
  for (const [i, text] of [title, "No values match the selected filters."].entries()) {
    const row = add(data, "row", { r: i + 1 });
    add(add(add(row, "c", { r: "A" + (i + 1), t: "inlineStr" }), "is"), "t", {}, text);
  }
  return sheet;
}

export function drawingPart(table: ChartTable) {
  const { width, height } = layout(table);
  const drawing = root(ns.xdr, "xdr:wsDr"), anchor = add(drawing, "xdr:oneCellAnchor");
  const from = add(anchor, "xdr:from");
  for (const tag of ["col", "colOff", "row", "rowOff"]) add(from, "xdr:" + tag, {}, 0);
  add(anchor, "xdr:ext", { cx: width * 9525, cy: height * 9525 });
  const frame = add(anchor, "xdr:graphicFrame", { macro: "" }), nv = add(frame, "xdr:nvGraphicFramePr");
  add(nv, "xdr:cNvPr", { id: 1, name: table.title });
  add(nv, "xdr:cNvGraphicFramePr");
  const transform = add(frame, "xdr:xfrm");
  add(transform, "a:off", { x: 0, y: 0 });
  add(transform, "a:ext", { cx: 0, cy: 0 });
  const graphic = add(frame, "a:graphic");
  add(add(graphic, "a:graphicData", { uri: ns.c }), "c:chart", { "r:id": "rId1" });
  add(anchor, "xdr:clientData");
  return drawing;
}

function title(parent: Element, value: string) {
  const box = add(parent, "c:title");
  const rich = add(add(box, "c:tx"), "c:rich");
  add(rich, "a:bodyPr"); add(rich, "a:lstStyle");
  add(add(add(rich, "a:p"), "a:r"), "a:t", {}, value);
  add(box, "c:overlay", { val: 0 });
}

function reference(parent: Element, formula: string, values: readonly (string | number | null)[], numeric = false) {
  const ref = add(parent, numeric ? "c:numRef" : "c:strRef");
  add(ref, "c:f", {}, formula);
  const cache = add(ref, numeric ? "c:numCache" : "c:strCache");
  if (numeric) add(cache, "c:formatCode", {}, "General");
  add(cache, "c:ptCount", { val: values.length });
  values.forEach((v, idx) => {
    if (v !== null) add(add(cache, "c:pt", { idx }), "c:v", {}, v);
  });
}

const val = (parent: Element, tag: string, value: string | number) => add(parent, "c:" + tag, { val: value });
const pxToEmu = (px: number) => Math.round(px * 9525);
const fill = (parent: Element, color: string) => add(add(parent, "a:solidFill"), "a:srgbClr", { val: color.slice(1).toUpperCase() });

function stroke(parent: Element, color: string, widthPx: number) {
  const line = add(parent, "a:ln", { w: pxToEmu(widthPx) });
  fill(line, color);
  return line;
}

function textStyle(parent: Element, color: string, sizePx: number, bold = false) {
  const body = add(parent, "c:txPr");
  add(body, "a:bodyPr", { rot: 0, vert: "horz" }); add(body, "a:lstStyle");
  const paragraph = add(body, "a:p");
  const text = add(add(paragraph, "a:pPr"), "a:defRPr", { sz: sizePx * 75, b: bold ? 1 : 0 });
  fill(text, color);
  add(text, "a:latin", { typeface: "Arial" });
  add(paragraph, "a:endParaRPr", { lang: "en-US" });
}

function categoryRef(parent: Element, prefix: string, table: ChartTable) {
  const { count, first } = layout(table), levels = table.levels;
  const address = `${prefix}$A$${first}:$${col(levels.length)}$${first + count - 1}`;
  if (levels.length === 1) { reference(parent, address, levels[0].values); return; }
  const ref = add(parent, "c:multiLvlStrRef");
  add(ref, "c:f", {}, address);
  const cache = add(ref, "c:multiLvlStrCache");
  val(cache, "ptCount", count);
  // OOXML caches levels in reverse column order. Sparse outer indexes start new groups.
  for (const { values } of [...levels].reverse()) {
    const level = add(cache, "c:lvl");
    values.forEach((v, idx) => { if (v !== null) add(add(level, "c:pt", { idx }), "c:v", {}, v); });
  }
}

function dataLabels(ser: Element, table: ChartTable, index: number, prefix: string, color: string) {
  const pie = table.type === "average", line = table.type === "progression";
  const labels = add(ser, "c:dLbls"), { first, labelCol } = layout(table);
  if (table.codes.length || pie) table.series[index].values.forEach((v, i) => {
    const label = add(labels, "c:dLbl");
    val(label, "idx", i);
    if (table.codes.length) {
      const display = v === null ? "" : table.codes[v - 1] ?? String(v);
      reference(add(label, "c:tx"), `${prefix}$${col(labelCol + index)}$${first + i}`, [display]);
    }
    if (pie) textStyle(label, dashboardChartSeriesColor(i), style.valueFontSizePx);
    if (table.codes.length) val(label, "showVal", 0);
  });
  textStyle(labels, color, style.valueFontSizePx, line);
  val(labels, "dLblPos", line ? "t" : "outEnd");
  val(labels, "showLegendKey", 0); val(labels, "showVal", 1);
  val(labels, "showCatName", 0); val(labels, "showSerName", 0); val(labels, "showPercent", 0);
  if (pie) val(labels, "showLeaderLines", 1);
}

function axisStyle(axis: Element, size: number, tickPosition: "low" | "nextTo") {
  val(axis, "majorTickMark", "none"); val(axis, "minorTickMark", "none");
  val(axis, "tickLblPos", tickPosition);
  stroke(add(axis, "c:spPr"), "#88939c", 1);
  textStyle(axis, style.axisTextColor, size);
}

function axisCodeFormat(codes: readonly string[], bounded: boolean) {
  // Excel admits two conditions and one fallback. Never mislabel fractional/out-of-range scores.
  if (!bounded || codes.length > 3 || codes.some(code => !code || /["\\;\r\n]/.test(code))) return;
  const format = codes.slice(0, 2).map((code, i) => `[=${i + 1}]"${code}"`).concat(codes.length === 3 ? `"${codes[2]}"` : "General").join(";");
  return format.length <= 255 ? format : undefined;
}

function axes(plot: Element, table: ChartTable) {
  const category = add(plot, "c:catAx");
  val(category, "axId", 1); val(add(category, "c:scaling"), "orientation", "minMax");
  val(category, "delete", 0);
  val(category, "axPos", "b"); axisStyle(category, 11, "low");
  val(category, "crossAx", 2); val(category, "crosses", "autoZero");
  val(category, "auto", 1); val(category, "lblAlgn", "ctr"); val(category, "lblOffset", 100);
  val(category, "tickLblSkip", 1); val(category, "noMultiLvlLbl", 0);
  const value = add(plot, "c:valAx");
  val(value, "axId", 2);
  const scale = add(value, "c:scaling");
  val(scale, "orientation", "minMax");
  const bounded = table.codes.length > 0 && table.series.every(s => s.values.every(v => v === null || (v >= 1 && v <= table.codes.length)));
  if (bounded) { val(scale, "max", Math.max(2, table.codes.length)); val(scale, "min", 1); }
  val(value, "delete", 0);
  val(value, "axPos", "l");
  const grid = stroke(add(add(value, "c:majorGridlines"), "c:spPr"), style.gridColor, 1);
  const [dash, space] = style.gridDashArray.split(" ").map(Number);
  add(add(grid, "a:custDash"), "a:ds", { d: dash * 100000, sp: space * 100000 });
  const format = axisCodeFormat(table.codes, bounded);
  if (table.codes.length && !format) {
    const key = table.codes.map((code, i) => `${i + 1} = ${code}`).join("; ");
    title(value, key.length <= 64 ? key : "Scale score (key below chart)");
  }
  add(value, "c:numFmt", { formatCode: format ?? "General", sourceLinked: 0 });
  axisStyle(value, style.valueFontSizePx, "nextTo");
  val(value, "crossAx", 1); val(value, "crosses", "autoZero");
  val(value, "crossBetween", "between");
  if (bounded) val(value, "majorUnit", 1);
}

function yearBands(plot: Element, table: ChartTable) {
  const shape = add(plot, "c:spPr"), years = table.levels[0].values;
  const starts = years.flatMap((year, i) => year !== null ? [i] : []);
  if (starts.length <= 1) { fill(shape, style.yearBandColors[0]); return; }
  const gradient = add(shape, "a:gradFill"), stops = add(gradient, "a:gsLst");
  const stop = (pos: number, color: string) =>
    add(add(stops, "a:gs", { pos }), "a:srgbClr", { val: color.slice(1).toUpperCase() });
  // The preview starts each new year at its first tick. On a between-category
  // axis that tick is half a slot in, not at the leading edge of its category.
  const slot = 100000 / years.length;
  const halfLine = Math.min(slot / 4, 75000 / layout(table).width);
  let color: string = style.yearBandColors[0];
  stop(0, color);
  starts.slice(1).forEach((index, i) => {
    const center = (index + 0.5) * slot;
    const before = Math.round(center - halfLine), after = Math.round(center + halfLine);
    stop(before, color); stop(before, style.yearBoundaryColor);
    color = style.yearBandColors[(i + 1) % 2];
    stop(after, style.yearBoundaryColor); stop(after, color);
  });
  stop(100000, color);
  add(gradient, "a:lin", { ang: 0, scaled: 0 });
}

export function chartPart(table: ChartTable, sheet: string) {
  const space = root(ns.c, "c:chartSpace"), chart = add(space, "c:chart");
  title(chart, table.title);
  const plot = add(chart, "c:plotArea"), pie = table.type === "average", bar = table.type === "comparison";
  const group = add(plot, pie ? "c:pieChart" : bar ? "c:barChart" : "c:lineChart");
  if (bar) val(group, "barDir", "col");
  if (!pie) val(group, "grouping", bar ? "clustered" : "standard");
  val(group, "varyColors", pie ? 1 : 0);
  const prefix = "'" + sheet.replace(/'/g, "''") + "'!";
  const { count, first, header, valueCol } = layout(table);
  const range = (column: string) => `${prefix}$${column}$${first}:$${column}$${header + count}`;
  table.series.forEach((s, idx) => {
    const ser = add(group, "c:ser"), column = col(idx + valueCol);
    val(ser, "idx", idx); val(ser, "order", idx);
    reference(add(ser, "c:tx"), `${prefix}$${column}$${header}`, [s.name]);
    const color = dashboardChartSeriesColor(idx + table.seriesOffset);
    if (pie) {
      s.values.forEach((_, i) => {
        const point = add(ser, "c:dPt"); val(point, "idx", i);
        const shape = add(point, "c:spPr"); fill(shape, dashboardChartSeriesColor(i)); stroke(shape, "#ffffff", 1);
      });
    } else if (bar) {
      const shape = add(ser, "c:spPr"); fill(shape, color); add(add(shape, "a:ln"), "a:noFill");
      val(ser, "invertIfNegative", 0);
    } else {
      stroke(add(ser, "c:spPr"), color, style.lineWidthPx);
      const marker = add(ser, "c:marker"); val(marker, "symbol", "circle");
      val(marker, "size", Math.round(style.markerRadiusPx * 2 * 0.75)); // Excel marker diameters are in points.
      const shape = add(marker, "c:spPr"); fill(shape, "#ffffff"); stroke(shape, color, style.lineWidthPx);
    }
    dataLabels(ser, table, idx, prefix, color);
    categoryRef(add(ser, "c:cat"), prefix, table);
    reference(add(ser, "c:val"), range(column), s.values, true);
    if (!pie && !bar) val(ser, "smooth", 0);
  });
  if (pie) val(group, "firstSliceAng", 90);
  else {
    val(group, "axId", 1); val(group, "axId", 2);
    axes(plot, table);
    yearBands(plot, table);
  }
  const legend = add(chart, "c:legend");
  val(legend, "legendPos", "b"); val(legend, "overlay", 0);
  textStyle(legend, "#34434e", 13);
  val(chart, "plotVisOnly", 1);
  val(chart, "dispBlanksAs", table.type === "progression" ? "span" : "gap");
  const background = add(space, "c:spPr"); fill(background, "#ffffff"); add(add(background, "a:ln"), "a:noFill");
  return space;
}
