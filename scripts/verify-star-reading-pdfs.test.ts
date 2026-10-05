import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { defaultRounds, type AssessmentTemplate } from "../lib/assessment-templates";
import { applyReportImport, parseStarReportPdf } from "../lib/report-pdf-import";
import { hydrateOrfRow } from "../lib/sample-results";

// Private source reports remain outside the app repository and are never
// uploaded. Assertions report only counts, page numbers and validation issues.
const directory = resolve(process.env.STAR_READING_PDF_DIR ?? "../project-resources/Lindseys spreadsheets/Star Reading/Star Reading - Sept 2025");
const files = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".pdf")) : [];
const expectedCounts: Record<string, number> = { "3": 12, "4": 14, "5": 28, "6": 28, "7": 28, "8": 42, "9": 42, "10": 42, "11": 42, "12": 36 };

it.skipIf(!files.length)("extracts and maps all five labeled metrics from the supplied Star Reading class reports", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const codes = new Set<string>();
  let studentCount = 0;
  for (const fileName of files) {
    const grade = /Grade (\d+)/.exec(fileName)![1];
    const task = getDocument({ data: new Uint8Array(readFileSync(resolve(directory, fileName))), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push({ pageNumber, text: content.items.flatMap((item) => "str" in item ? [item.str] : []).join("\n") });
        page.cleanup();
      }
      const report = parseStarReportPdf(pages, fileName, "fixture");
      expect(report.issues, `Grade ${grade} document issues`).toEqual([]);
      expect(report.students.length, `Grade ${grade} student count`).toBe(expectedCounts[grade]);
      studentCount += report.students.length;
      expect(report.students.filter((student) => student.issues.length || student.assessmentKind !== "Star Reading" || student.schoolYear !== "2025-2026" || student.season !== "fall")
        .map(({ pageNumber, issues, schoolYear }) => ({ pageNumber, issues, schoolYear }))).toEqual([]);
      expect(report.students.every((student) => Object.keys(student.values).length === 5), `Grade ${grade}: five results per student`).toBe(true);
      for (const student of report.students) {
        expect(String(student.values.instructionalReadingLevel)).toMatch(/^(?:PHS|PP|P|\d+\.\d+)$/);
        expect(String(student.values.zoneOfProximalDevelopment)).toMatch(/^\d+\.\d+ - \d+\.\d+$/);
        if (/^[A-Z]+$/.test(String(student.values.instructionalReadingLevel))) codes.add(String(student.values.instructionalReadingLevel));
      }
      const first = report.students[0];
      const template: AssessmentTemplate = { id: "star-reading", name: "Star Reading", category: "Reports", description: "", gradeScope: "3-12", rounds: defaultRounds,
        fields: ["PR", "IRL", "ZPD"].map((name) => ({ id: name, name, slug: name.toLowerCase(), dataType: name === "PR" ? "integer" : "text", isRequired: false, isCalculated: false, visibility: "evaluators" })) };
      const applied = applyReportImport({ selection: { schoolYear: first.schoolYear, grade: first.grade, assessmentId: template.id, roundId: "fall" },
        documents: [{ ...report, students: [first] }], selectedRowIds: [`fixture:${first.pageNumber}`] }, {
        rows: [hydrateOrfRow({ id: "fixture", student: first.studentName, homeroom: "test", septP1Wpm: null, septP1Epm: null, septP2Wpm: null, septP2Epm: null, septP3Wpm: null, septP3Epm: null })],
        placements: [{ studentId: "fixture", schoolYear: first.schoolYear, grade: first.grade, homeroom: "test" }], templates: [template], schoolYears: [first.schoolYear]
      });
      expect(applied.dataCellCount).toBe(3);
      expect(Object.values(applied.rows[0].assessmentValues!)).toEqual([first.values.percentileRank, first.values.instructionalReadingLevel, first.values.zoneOfProximalDevelopment]);
    } finally { await task.destroy(); }
  }
  expect(studentCount).toBe(314);
  expect([...codes].sort()).toEqual(["P", "PHS", "PP"]);
}, 180_000);
