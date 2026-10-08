import { describe, expect, it } from "vitest";
import { read, utils } from "xlsx";
import { defaultRounds, type AssessmentFieldTemplate, type AssessmentTemplate } from "./assessment-templates";
import { assessmentValueKey, entryValue } from "./assessment-entry";
import { hydrateOrfRow } from "./sample-results";
import { applyReportImport, parseStarReportPdf, reportAttentionCsv, reportStudentNameKey, reviewReportImport, type ReportImportSelection, type ReportImportWorkspace } from "./report-pdf-import";

const field: AssessmentFieldTemplate = { id: "pr", name: "PR", slug: "pr", dataType: "integer", isRequired: false, isCalculated: false, visibility: "evaluators" };
const assessment: AssessmentTemplate = { id: "custom-8", name: "Star Math", category: "Custom", description: "", gradeScope: "3-12", rounds: defaultRounds, fields: [field] };
const selection: ReportImportSelection = { schoolYear: "2025-2026", grade: "4", assessmentId: assessment.id, roundId: "fall" };
const source = `Instructional Planning - Student Report Star Math Enterprise
  School Example School Student Bennett, Ava Test Date Sep 10, 2025 11:08 AM Grade 4 Teacher Example
  Star Math Enterprise Tests Results SS (Scaled Score) 935 On Watch 700 800 900 1000 1100 1200 1300
  Projected SS (for 8/30/26) 1008 PR (Percentile Rank) 28 Suggested Skills 99 123`;
const document = () => parseStarReportPdf([{ pageNumber: 1, text: source }, { pageNumber: 2, text: "Suggested Skills 1 2 3" }], "class.pdf", "file-1");
function workspace(): ReportImportWorkspace {
  return {
    rows: [hydrateOrfRow({ id: "ava", student: "Ava Bennett", homeroom: "4A", septP1Wpm: null, septP1Epm: null, septP2Wpm: null, septP2Epm: null, septP3Wpm: null, septP3Epm: null })],
    placements: [{ studentId: "ava", schoolYear: "2025-2026", grade: "4", homeroom: "4A" }],
    templates: [structuredClone(assessment)], schoolYears: ["2024-2025", "2025-2026", "2026-2027"], lockedOverviewYears: []
  };
}
const request = () => ({ selection, documents: [document()], selectedRowIds: ["file-1:1"] });

describe("Star Math PDF parsing", () => {
  it("reads labeled scores rather than graph numbers, and ignores instructional pages", () => {
    const parsed = document();
    expect(parsed.issues).toEqual([]);
    expect(parsed.students).toHaveLength(1);
    expect(parsed.students[0]).toEqual({ assessmentKind: "Star Math", pageNumber: 1, studentName: "Bennett, Ava", grade: "4", testDate: "2025-09-10", schoolYear: "2025-2026", season: "fall", values: { scaledScore: 935, projectedScore: 1008, percentileRank: 28 }, issues: [] });
  });
  it("reads every student in a class PDF", () => {
    const parsed = parseStarReportPdf([{ pageNumber: 1, text: source }, { pageNumber: 4, text: source.replace("Bennett, Ava", "Singh, Blake").replace("Rank) 28", "Rank) 65") }], "class.pdf", "class");
    expect(parsed.students.map((row) => row.values.percentileRank)).toEqual([28, 65]);
  });
  it("accepts reports with no Teacher header", () => {
    const parsed = parseStarReportPdf([{ pageNumber: 1, text: source.replace("Teacher Example", "Class/Group Grade 4") }], "class.pdf", "a");
    expect(parsed.students[0]).toMatchObject({ grade: "4", testDate: "2025-09-10", issues: [] });
  });
  it("rejects a different assessment, unreadable reports, and impossible test dates", () => {
    expect(parseStarReportPdf([{ pageNumber: 1, text: source.replaceAll("Star Math", "Star Early Literacy") }], "early-literacy.pdf", "a").students[0].issues.join(" ")).toContain("not a supported");
    expect(parseStarReportPdf([{ pageNumber: 1, text: "unrelated PDF" }], "other.pdf", "b").issues).not.toHaveLength(0);
    expect(parseStarReportPdf([{ pageNumber: 1, text: source.replace("Sep 10", "Feb 30") }], "bad.pdf", "c").students[0].issues.join(" ")).toContain("test date");
  });
  it("derives winter and spring dates from the school year, not the projection date", () => {
    for (const [date, season] of [["Jan 10, 2026", "winter"], ["May 10, 2026", "spring"]]) {
      const parsed = parseStarReportPdf([{ pageNumber: 1, text: source.replace("Sep 10, 2025", date) }], "class.pdf", "a");
      expect(parsed.students[0]).toMatchObject({ schoolYear: "2025-2026", season });
    }
  });
  it("normalizes order and annotations without guessing a different name", () => {
    expect(reportStudentNameKey("Bennett, Ava")).toBe(reportStudentNameKey("Ava (A.) Bennett - she/her"));
    expect(reportStudentNameKey("Ava Bennett")).not.toBe(reportStudentNameKey("Eva Bennett"));
  });
});

describe("report validation and year-scoped persistence", () => {
  it("imports verified rows and skips invalid rows in the same selected batch", () => {
    const parsed = parseStarReportPdf([{ pageNumber: 1, text: source }, { pageNumber: 3, text: source.replace("Bennett, Ava", "Singh, Blake") }], "mixed.pdf", "file-1");
    const state = workspace(); const original = structuredClone(state);
    const applied = applyReportImport({ selection, documents: [parsed], selectedRowIds: ["file-1:1", "file-1:3"] }, state);
    expect(applied.reviewedRows.map((row) => row.id)).toEqual(["file-1:1"]);
    expect(applied.dataCellCount).toBe(1);
    expect(applied.updatedRows.map((row) => row.studentId)).toEqual(["ava"]);
    expect(state).toEqual(original);
    const report = reportAttentionCsv([parsed], selection, reviewReportImport([parsed], selection, state))!;
    expect(report.count).toBe(1);
    const workbook = read(report.csv, { type: "string", raw: true });
    const rows = utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["2025-2026", "4", "Star Math", "September / Fall", "Singh, Blake", "", "", "mixed.pdf", "3", "2025-09-10", "2025-2026", "4", "935", "1008", "28", "No matching student in Grade 4 for 2025-2026."]);
  });
  it("does not let an unreadable page block verified students in the same PDF", () => {
    const parsed = parseStarReportPdf([{ pageNumber: 1, text: source }, { pageNumber: 3, text: "Instructional Planning - Student Report Star Math Enterprise" }], "mixed.pdf", "file-1");
    const review = reviewReportImport([parsed], selection, workspace());
    expect(parsed.issues).toHaveLength(1);
    expect(review.rows[0].issues).toEqual([]);
    expect(applyReportImport({ ...request(), documents: [parsed] }, workspace()).dataCellCount).toBe(1);
    expect(reportAttentionCsv([parsed], selection, review)?.csv).toContain("Page 3: the student name could not be read.");
  });
  it("leaves an existing student's saved values untouched when their report is invalid", () => {
    const state = workspace();
    const key = assessmentValueKey(assessment, assessment.rounds[0], field, undefined, selection);
    const invalidStudent = { ...state.rows[0], id: "blake", student: "Blake Singh", assessmentValues: { [key]: 12 } };
    state.rows.push(invalidStudent);
    state.placements.push({ ...state.placements[0], studentId: "blake" });
    const parsed = parseStarReportPdf([{ pageNumber: 1, text: source }, { pageNumber: 3, text: source.replace("Bennett, Ava", "Singh, Blake").replace("Rank) 28", "Rank) 120") }], "mixed.pdf", "file-1");
    const applied = applyReportImport({ selection, documents: [parsed], selectedRowIds: ["file-1:1", "file-1:3"] }, state);
    expect(applied.rows[1]).toBe(invalidStudent);
    expect(applied.updatedRows.map((row) => row.studentId)).toEqual(["ava"]);
    expect(reportAttentionCsv([parsed], selection, reviewReportImport([parsed], selection, state))?.csv).toContain('"120"');
  });
  it("does not treat a wrong-round report as a duplicate of a valid report", () => {
    const parsed = parseStarReportPdf([{ pageNumber: 1, text: source }, { pageNumber: 3, text: source.replace("Sep 10, 2025", "Jan 10, 2026") }], "mixed.pdf", "file-1");
    const review = reviewReportImport([parsed], selection, workspace());
    expect(review.rows[0].issues).toEqual([]);
    expect(review.rows[1].issues.join(" ")).toContain("does not match");
    expect(applyReportImport({ ...request(), documents: [parsed], selectedRowIds: ["file-1:1", "file-1:3"] }, workspace()).reviewedRows).toHaveLength(1);
  });
  it("exports unreadable files, escapes CSV text and neutralizes formulas", () => {
    const parsed = { id: "bad", fileName: '=HYPERLINK("example")\r\nreport.pdf', students: [], issues: ["Unreadable, encrypted PDF"] };
    const report = reportAttentionCsv([parsed], selection, reviewReportImport([parsed], selection, workspace()))!;
    expect(report.csv.startsWith("\uFEFF")).toBe(true);
    expect(report.csv.endsWith("\r\n")).toBe(true);
    const book = read(report.csv, { type: "string", raw: true });
    const rows = utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1 });
    expect(rows[1][7]).toBe("'" + parsed.fileName.replaceAll("\r\n", "\n"));
    expect(report.csv).toContain('"\'=HYPERLINK(""example"")\r\nreport.pdf"');
    expect(rows[1][15]).toBe(parsed.issues[0]);
    expect(report.count).toBe(1);
  });
  it("does not export valid rows and still rejects batches with no verified rows", () => {
    expect(reportAttentionCsv([document()], selection, reviewReportImport([document()], selection, workspace()))).toBeNull();
    const state = workspace(); state.placements = [];
    expect(() => applyReportImport(request(), state)).toThrow("verified");
    expect(reportAttentionCsv([document()], selection, reviewReportImport([document()], selection, state))?.count).toBe(1);
  });
  it("matches only the existing student's selected year and grade placement", () => {
    const state = workspace();
    expect(reviewReportImport([document()], selection, state).rows[0]).toMatchObject({ studentId: "ava", homeroom: "4A", issues: [] });
    state.placements[0].schoolYear = "2024-2025";
    expect(reviewReportImport([document()], selection, state).rows[0].issues.join(" ")).toContain("No matching student");
    state.placements[0].schoolYear = "2025-2026";
    state.placements[0].grade = "5";
    expect(reviewReportImport([document()], selection, state).rows[0].studentId).toBeUndefined();
  });
  it.each([
    [{ schoolYear: "2026-2027" }, "PDF test year"],
    [{ grade: "5" }, "PDF grade"],
    [{ roundId: "winter" }, "does not match"]
  ])("blocks mismatched selections %j", (patch, message) => {
    expect(reviewReportImport([document()], { ...selection, ...patch }, workspace()).rows[0].issues.join(" ")).toContain(message);
  });
  it("rejects a locked year or an unsupported assessment", () => {
    const state = workspace();
    state.lockedOverviewYears = [selection.schoolYear];
    expect(() => applyReportImport(request(), state)).toThrow("locked");
    state.lockedOverviewYears = [];
    state.templates[0].name = "Other assessment";
    expect(() => applyReportImport(request(), state)).toThrow("supports Star Math");
  });
  it("rejects ambiguous students and repeated reports", () => {
    const state = workspace();
    state.rows.push({ ...state.rows[0], id: "other" });
    state.placements.push({ ...state.placements[0], studentId: "other" });
    expect(reviewReportImport([document()], selection, state).rows[0].issues.join(" ")).toContain("More than one student");
    const duplicate = { ...document(), id: "file-2" };
    expect(reviewReportImport([document(), duplicate], selection, workspace()).rows.every((row) => row.issues.some((issue) => issue.includes("more than once")))).toBe(true);
  });
  it("requires all mapped scores and validates field limits", () => {
    const state = workspace();
    state.templates[0].fields[0].validationConfig = { max: 20 };
    expect(reviewReportImport([document()], selection, state).rows[0].issues.length).toBeGreaterThan(0);
    const missing = document();
    delete missing.students[0].values.percentileRank;
    expect(reviewReportImport([missing], selection, workspace()).rows[0].issues.join(" ")).toContain("PR is missing");
  });
  it("honors year-specific definitions, sections and grade-specific fields", () => {
    const state = workspace();
    state.templates[0].yearDefinitions = { [selection.schoolYear]: { ...assessment, sections: [{ id: "scores", name: "Results", roundIds: ["fall"] }], fields: [
      { ...field, name: "Percentile Rank", sectionIds: ["scores"] },
      { ...field, id: "other-grade", name: "Other grade", gradeIds: ["8"] },
      { ...field, id: "winter-only", name: "Winter", roundIds: ["winter"] }
    ] } };
    const review = reviewReportImport([document()], selection, state);
    expect(review.columns).toHaveLength(1);
    expect(review.columns[0].section?.name).toBe("Results");
    expect(review.columns[0].field.name).toBe("Percentile Rank");
    const applied = applyReportImport(request(), state);
    expect(Object.values(applied.rows[0].assessmentValues!)).toEqual([28]);
  });
  it("does not copy one score into multiple same-named section columns", () => {
    const state = workspace();
    state.templates[0].sections = [{ id: "a", name: "A", roundIds: ["fall"] }, { id: "b", name: "B", roundIds: ["fall"] }];
    state.templates[0].fields[0].sectionIds = ["a", "b"];
    expect(() => applyReportImport(request(), state)).toThrow("same report metric");
  });
  it("preserves unmapped optional columns but blocks unmapped required ones", () => {
    const state = workspace();
    state.templates[0].fields.push({ ...field, id: "custom", name: "Custom metric", slug: "custom" });
    expect(reviewReportImport([document()], selection, state).unmatchedFields).toEqual(["Custom metric"]);
    expect(applyReportImport(request(), state).dataCellCount).toBe(1);
    state.templates[0].fields[1].isRequired = true;
    expect(() => applyReportImport(request(), state)).toThrow("Required fields");
  });
  it("writes only selected cells, retains other years/rounds, and stores reversal snapshots", () => {
    const state = workspace();
    const key = assessmentValueKey(assessment, assessment.rounds[0], field, undefined, selection);
    state.rows[0].assessmentValues = { [key]: 19, unrelated: 77 };
    const original = structuredClone(state);
    const applied = applyReportImport(request(), state);
    expect(applied.rows[0].assessmentValues).toEqual({ [key]: 28, unrelated: 77 });
    expect(entryValue(applied.rows[0], assessment, assessment.rounds[0], field, undefined, selection)).toBe(28);
    expect(entryValue(applied.rows[0], assessment, assessment.rounds[1], field, undefined, selection)).toBeNull();
    expect(entryValue(applied.rows[0], assessment, assessment.rounds[0], field, undefined, { ...selection, schoolYear: "2026-2027" })).toBeNull();
    expect(applied.updatedRows).toEqual([{ studentId: "ava", previousRow: original.rows[0], nextRow: applied.rows[0] }]);
    expect(state).toEqual(original);
    expect(applyReportImport(request(), { ...state, rows: applied.rows }).dataCellCount).toBe(0);
  });
  it("accepts authoritative values for calculated fields", () => {
    const state = workspace();
    state.templates[0].fields[0] = { ...field, isCalculated: true, dataType: "calculated" };
    expect(applyReportImport(request(), state).dataCellCount).toBe(1);
  });
  it("revalidates against current roster and rejects unknown selections", () => {
    expect(() => applyReportImport({ ...request(), selectedRowIds: ["missing"] }, workspace())).toThrow("verified");
    const state = workspace();
    state.placements = [];
    expect(() => applyReportImport(request(), state)).toThrow("verified");
  });
});
