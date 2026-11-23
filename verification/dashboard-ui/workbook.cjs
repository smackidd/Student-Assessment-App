const assert = require("node:assert/strict");
const { posix } = require("node:path");
const XLSX = require("xlsx");
const { DOMParser } = require("@xmldom/xmldom");

// Read the downloaded bytes independently of the exporter's chart model and XML writer.
function inspectWorkbook(file, { categoryLevelNames } = {}) {
  const book = XLSX.readFile(file, { bookFiles: true });
  const read = path => {
    assert.ok(book.files[path], "Missing package part " + path);
    return new DOMParser().parseFromString(Buffer.from(book.files[path].content).toString("utf8"), "application/xml");
  };
  const elements = (node, tag) => Array.from(node.getElementsByTagNameNS("*", tag));
  const relationship = (from, marker, kind) => {
    const rels = posix.join(posix.dirname(from), "_rels", posix.basename(from) + ".rels");
    const link = elements(read(rels), "Relationship").find(r => r.getAttribute("Id") === marker.getAttribute("r:id"));
    assert.ok(link?.getAttribute("Type").endsWith("/" + kind), "Missing " + kind + " relationship from " + from);
    const target = link.getAttribute("Target");
    return target.startsWith("/") ? target.slice(1) : posix.join(posix.dirname(from), target);
  };
  function points(ser, tag) {
    const ref = elements(ser, tag)[0];
    const formula = elements(ref, "f")[0].textContent;
    const split = formula.lastIndexOf("!");
    const name = formula.slice(0, split).replace(/^'|'$/g, "").replace(/''/g, "'");
    const sheet = book.Sheets[name];
    assert.ok(sheet, "Unknown worksheet in chart formula: " + formula);
    const range = XLSX.utils.decode_range(formula.slice(split + 1).replace(/\$/g, ""));
    const count = Number(elements(ref, "ptCount")[0].getAttribute("val"));
    function checkedColumn(column, level) {
      const cells = [];
      for (let r = range.s.r; r <= range.e.r; r++) cells.push(sheet[XLSX.utils.encode_cell({ r, c: column })]?.v ?? null);
      const cache = Array(count).fill(null);
      for (const pt of elements(level, "pt")) {
        const raw = elements(pt, "v")[0].textContent;
        cache[Number(pt.getAttribute("idx"))] = tag === "val" ? Number(raw) : raw;
      }
      assert.deepEqual(cache, cells, "Chart cache disagrees with " + formula + " column " + XLSX.utils.encode_col(column));
      return cells;
    }
    const levels = elements(ref, "lvl");
    if (tag === "cat" && categoryLevelNames) {
      assert.equal(levels.length, categoryLevelNames.length, "Expected native category levels");
      const headers = Array.from({ length: levels.length }, (_, i) =>
        sheet[XLSX.utils.encode_cell({ r: range.s.r - 1, c: range.s.c + i })]?.v);
      assert.deepEqual(headers, categoryLevelNames, "Unexpected category level order");
    }
    if (!levels.length) {
      assert.equal(range.s.c, range.e.c, "Expected one column of chart values");
      return checkedColumn(range.s.c, ref);
    }
    assert.equal(tag, "cat");
    assert.equal(levels.length, range.e.c - range.s.c + 1, "Category range must cover every level");
    // Excel stores innermost first. Blank outer cells continue a group until its parent changes.
    const columns = levels.reverse().map((level, i) => checkedColumn(range.s.c + i, level));
    const labels = Array(columns.length).fill(null);
    return Array.from({ length: count }, (_, row) => {
      columns.forEach((column, i) => {
        if (column[row] !== null || i === columns.length - 1) {
          labels.fill(null, i + 1);
          labels[i] = column[row];
        }
      });
      return labels.filter(label => label !== null).join(" \u00b7 ");
    });
  }
  const workbookPath = "xl/workbook.xml", charts = [], parts = [];
  for (const sheet of elements(read(workbookPath), "sheet")) {
    const sheetPath = relationship(workbookPath, sheet, "worksheet");
    for (const drawing of elements(read(sheetPath), "drawing")) {
      const drawingPath = relationship(sheetPath, drawing, "drawing");
      for (const marker of elements(read(drawingPath), "chart")) {
        const chartPath = relationship(drawingPath, marker, "chart"), xml = read(chartPath);
        parts.push(chartPath);
        charts.push({
          title: elements(elements(xml, "title")[0], "t").map(t => t.textContent).join(""),
          series: elements(xml, "ser").map(ser => ({
            type: ser.parentNode.localName, name: points(ser, "tx")[0], categories: points(ser, "cat"), values: points(ser, "val")
          }))
        });
      }
    }
  }
  assert.deepEqual(parts.sort(), book.keys.filter(path => /^xl\/charts\/[^/]+\.xml$/.test(path)).sort(), "Orphan chart parts");
  const rows = Object.fromEntries(book.SheetNames.map(name => [
    name, XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, blankrows: false })
  ]));
  return { charts: charts.sort((a, b) => a.title.localeCompare(b.title)), sheets: book.SheetNames, rows, report: rows["Student Report"] };
}
module.exports = { inspectWorkbook };
