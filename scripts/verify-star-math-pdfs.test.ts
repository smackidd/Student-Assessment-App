import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { parseStarReportPdf } from "../lib/report-pdf-import";

// Private PDFs stay outside the app repository. This optional integration check
// verifies the supplied class exports without copying student data into fixtures.
const directory = resolve(process.env.STAR_MATH_PDF_DIR ?? "../project-resources/Lindseys spreadsheets/Star Math/Star Math - Sept 2025/Star Math - Sept 2025");
const files = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".pdf")) : [];
const expectedCounts: Record<string, number> = { "3": 12, "4": 14, "5": 28, "6": 28, "7": 28, "8": 42, "9": 42, "10": 42, "11": 42, "12": 36 };

it.skipIf(!files.length)("extracts every student's labeled scores from all supplied Star Math class PDFs", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const gradeMismatches: Array<{ fileGrade: string; pageNumber: number; reportGrade: string }> = [];
  for (const fileName of files) {
    const grade = /Grade (\d+)/.exec(fileName)?.[1];
    const task = getDocument({ data: new Uint8Array(readFileSync(resolve(directory, fileName))), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push({ pageNumber, text: content.items.flatMap((item) => "str" in item ? [item.str] : []).join("\n") });
        page.cleanup();
      }
      const report = parseStarReportPdf(pages, fileName, "fixture");
      expect(report.issues, `Grade ${grade} document issues`).toEqual([]);
      expect(report.students.length, `Grade ${grade} students`).toBe(expectedCounts[grade!]);
      expect(report.students.filter((student) => !/^(?:[3-9]|1[0-2])$/.test(student.grade) || student.schoolYear !== "2025-2026" || student.season !== "fall" || student.issues.length).map(({ pageNumber, grade, testDate, issues }) => ({ pageNumber, grade, testDate, issues })), `Grade ${grade} metadata`).toEqual([]);
      gradeMismatches.push(...report.students.filter((student) => student.grade !== grade).map((student) => ({ fileGrade: grade!, pageNumber: student.pageNumber, reportGrade: student.grade })));
      expect(report.students.every((student) => Object.keys(student.values).length === 3), `Grade ${grade} labeled scores`).toBe(true);
      expect(report.students.every((student) => student.studentName.includes(",") && !student.studentName.includes("Student Report")), `Grade ${grade} names`).toBe(true);
    } finally {
      await task.destroy();
    }
  }
  // These are genuine source discrepancies; never replace the report's grade
  // with the filename's grade to make a student match.
  expect(gradeMismatches).toEqual([
    { fileGrade: "11", pageNumber: 68, reportGrade: "10" },
    { fileGrade: "5", pageNumber: 31, reportGrade: "6" }
  ]);
}, 180_000);
