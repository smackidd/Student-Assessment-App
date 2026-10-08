export type PdfTextPage = { pageNumber: number; text: string };

export const PDF_IMPORT_LIMITS = { files: 20, bytesPerFile: 20 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, pages: 200 };

export async function readReportPdf(file: File, signal?: AbortSignal): Promise<PdfTextPage[]> {
  if (!/\.pdf$/i.test(file.name)) throw new Error("Select a PDF file.");
  if (file.size > PDF_IMPORT_LIMITS.bytesPerFile) throw new Error("This PDF exceeds the 20 MB limit.");
  const data = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(data.subarray(0, 1024)).includes("%PDF-")) {
    throw new Error("This file is not a valid PDF.");
  }
  signal?.throwIfAborted();
  const { getDocument, GlobalWorkerOptions, version } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker-${version}.min.mjs`;
  const task = getDocument({ data, useSystemFonts: false });
  const abort = () => { void task.destroy(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const pdf = await task.promise;
    if (pdf.numPages > PDF_IMPORT_LIMITS.pages) throw new Error("This PDF exceeds the 200-page limit. Split it into smaller PDFs.");
    const pages: PdfTextPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({ pageNumber, text: content.items.flatMap((item) => "str" in item ? [item.str] : []).join("\n") });
      page.cleanup();
    }
    if (!pages.some((page) => page.text.trim())) throw new Error("No readable text was found. Use the original Star Math or Star Reading PDF export, not a scanned image.");
    return pages;
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") throw new Error("This PDF is password protected. Select an unlocked copy.");
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}
