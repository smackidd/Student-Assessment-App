type LegendItem = { label: string; color: string };
type PdfImage = { jpeg: ArrayBuffer; width: number; height: number };
const density = 2;
const sheetWidth = 1040;
const pad = 28;
const usable = sheetWidth - 2 * pad;

// A small image-only PDF writer. Only one canvas tile is live at a time; no
// browser print dialog, network service, or canvas as wide as the dataset.
function imagePdf(pages: PdfImage[]) {
  const parts: BlobPart[] = [];
  const offsets = [0];
  let bytes = 0;
  const write = (s: string) => { parts.push(s); bytes += s.length; }; // PDF syntax is ASCII.
  const object = (id: number, s: string) => { offsets[id] = bytes; write(`${id} 0 obj\n${s}`); };
  write("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>\nendobj\n`);
  pages.forEach(({ jpeg, width, height }, i) => {
    const page = 3 + i * 3;
    const w = width * 0.75 / density, h = height * 0.75 / density;
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Plot ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>\nendobj\n`);
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Plot Do Q\n`;
    object(page + 1, `<< /Length ${draw.length} >>\nstream\n${draw}endstream\nendobj\n`);
    object(page + 2, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`);
    parts.push(jpeg);
    bytes += jpeg.byteLength;
    write("\nendstream\nendobj\n");
  });
  const xref = bytes;
  write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach(offset => write(`${String(offset).padStart(10, "0")} 00000 n \n`));
  write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

export function dashboardPdfSlices(width: number, axisWidth: number, ticks: number[]) {
  const slices: { start: number; end: number }[] = [];
  const breaks = ticks.slice(1).map((x, i) => (ticks[i] + x) / 2);
  let i = 0;
  for (let start = axisWidth; start < width;) {
    const limit = Math.min(width, start + usable - axisWidth);
    let end = limit;
    if (limit < width) {
      while (i < breaks.length && breaks[i] <= limit) i++;
      if (i && breaks[i - 1] > start) end = breaks[i - 1];
    }
    slices.push({ start, end });
    start = end;
  }
  return slices;
}

async function paintSlice(ctx: CanvasRenderingContext2D, source: SVGSVGElement, start: number, width: number, height: number, x: number) {
  if (width <= 0) return;
  source.setAttribute("viewBox", `${start} 0 ${width} ${height}`);
  source.setAttribute("width", String(width));
  source.setAttribute("height", String(height));
  // Give the SVG intrinsic high-resolution dimensions before drawing the tile.
  source.style.width = `${width * density}px`;
  source.style.height = `${height * density}px`;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(source)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    ctx.drawImage(image, x, 64, width, height);
  } finally { URL.revokeObjectURL(url); }
}

function legendRows(ctx: CanvasRenderingContext2D, items: LegendItem[]) {
  const rows: { x: number; label: string; color: string }[][] = [];
  let x = 0;
  ctx.font = "14px Arial";
  for (const item of items) {
    const lines: string[] = [];
    let line = "";
    for (const char of item.label) {
      if (line && ctx.measureText(line + char).width > usable - 30) { lines.push(line); line = ""; }
      line += char;
    }
    lines.push(line);
    for (const label of lines) {
      const w = 34 + ctx.measureText(label).width;
      if (!rows.length || x + w > usable) { rows.push([]); x = 0; }
      rows[rows.length - 1].push({ x: x + pad, label, color: item.color });
      x += w;
    }
  }
  return rows;
}

export async function buildDashboardChartPdf(svg: SVGSVGElement, title: string, legend: LegendItem[]) {
  const { width, height } = svg.viewBox.baseVal;
  if (!(width > 0 && height > 0)) throw new Error("Chart is not ready.");
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.style.fontFamily = getComputedStyle(svg).fontFamily;
  clone.querySelectorAll(".recharts-tooltip-cursor,.recharts-active-dot").forEach(n => n.remove());
  const axis = Number(svg.querySelector("[data-year-band] rect")?.getAttribute("x") ?? 0);
  const ticks = Array.from(svg.querySelectorAll<SVGGElement>("[data-axis-tick]")).map(g => g.transform.baseVal.getItem(0).matrix.e);
  const slices = dashboardPdfSlices(width, axis, ticks);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable.");
  const rows = legendRows(ctx, legend);
  const pages: PdfImage[] = [];
  // Short legends repeat with each strip. Very large legends continue on key pages.
  const legendPerChart = 6;
  const legendPerPage = 26;
  const pageCount = slices.length + Math.ceil(Math.max(0, rows.length - legendPerChart) / legendPerPage);
  for (let p = 0; p < pageCount; p++) {
    const slice = slices[p];
    const firstRow = slice ? 0 : legendPerChart + (p - slices.length) * legendPerPage;
    const visible = rows.slice(firstRow, firstRow + (slice ? legendPerChart : legendPerPage));
    const legendTop = (slice ? height : 0) + 84;
    canvas.width = density * sheetWidth;
    canvas.height = Math.ceil(density * (legendTop + visible.length * 22 + pad));
    ctx.scale(density, density);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, sheetWidth, canvas.height / density);
    ctx.fillStyle = "#243447";
    ctx.font = "bold 20px Arial";
    ctx.fillText(title, pad, 37, usable - 110);
    ctx.font = "13px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`${p + 1} / ${pageCount}`, sheetWidth - pad, 36);
    ctx.textAlign = "left";
    if (slice) {
      const left = slices.length === 1 ? pad + (usable - width) / 2 : pad;
      await paintSlice(ctx, clone, 0, axis, height, left);
      await paintSlice(ctx, clone, slice.start, slice.end - slice.start, height, left + axis);
    }
    ctx.font = "14px Arial";
    visible.forEach((row, i) => row.forEach(({ x, label, color }) => {
      const y = legendTop + i * 22;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 6, 12, 3);
      ctx.fillStyle = "#243447";
      ctx.fillText(label, x + 18, y);
    }));
    const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PDF tile failed.")), "image/jpeg", 0.96));
    pages.push({ jpeg: await jpeg.arrayBuffer(), width: canvas.width, height: canvas.height });
  }
  return imagePdf(pages);
}

export async function downloadDashboardChartPdf(svg: SVGSVGElement, title: string, legend: LegendItem[]) {
  const pdf = await buildDashboardChartPdf(svg, title, legend);
  const href = URL.createObjectURL(pdf);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30000);
}
