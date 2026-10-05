import { describe, expect, it } from "vitest";
import { read, utils } from "xlsx";
import { defaultRounds, type AssessmentFieldTemplate, type AssessmentTemplate } from "./assessment-templates";
import { assessmentValueKey } from "./assessment-entry";
import { hydrateOrfRow } from "./sample-results";
import { applyReportImport, parseStarReportPdf, reportAttentionCsv, reviewReportImport, starAssessmentKind, type ReportImportWorkspace } from "./report-pdf-import";

const source = `Instructional Planning - Student Report Star Reading Enterprise
  School Example School Student Bennett, Ava Test Date Sep 08, 2025 11:37 AM Grade 4 Teacher Example
  District Benchmark Scaled Score 700 800 900 1000 1100 1200 1300
  Star Reading Enterprise Tests Results SS (Scaled Score) 1006 At/Above Benchmark
  Projected SS (for 8/30/26) 1043 At/Above Benchmark PR (Percentile Rank) 60
  IRL (Instructional Reading Level) 4.0 Materials at the fourth grade level.
  ZPD (Zone of Proximal Development) 3.2 - 5.1 Suggested Skills 100 200 300`;
const field = (id: string, name: string, dataType: AssessmentFieldTemplate["dataType"]): AssessmentFieldTemplate => ({ id, name, slug: id, dataType, isRequired: false, isCalculated: false, visibility: "evaluators" });
const fields = [field("pr", "PR", "integer"), field("irl", "IRL", "text"), field("zpd", "ZPD", "text")];
const assessment: AssessmentTemplate = { id: "star-reading", name: "Star Reading", category: "Reports", description: "", gradeScope: "3-12", rounds: defaultRounds, fields };
const selection = { schoolYear: "2025-2026", grade: "4", assessmentId: assessment.id, roundId: "fall" };
const document = (text = source) => parseStarReportPdf([{ pageNumber: 1, text }], "reading.pdf", "reading");
function workspace(): ReportImportWorkspace {
  return { rows: [hydrateOrfRow({ id: "ava", student: "Ava Bennett", homeroom: "4A", septP1Wpm: null, septP1Epm: null, septP2Wpm: null, septP2Epm: null, septP3Wpm: null, septP3Epm: null })],
    placements: [{ studentId: "ava", schoolYear: "2025-2026", grade: "4", homeroom: "4A" }], templates: [structuredClone(assessment)], schoolYears: ["2025-2026", "2026-2027"] };
}
const request = (text = source) => ({ selection, documents: [document(text)], selectedRowIds: ["reading:1"] });

describe("Star Reading PDF import", () => {
  it("extracts only labeled results and preserves IRL decimals and ZPD ranges", () => {
    expect(document().students[0]).toMatchObject({ assessmentKind: "Star Reading", schoolYear: "2025-2026", grade: "4", issues: [],
      values: { scaledScore: 1006, projectedScore: 1043, percentileRank: 60, instructionalReadingLevel: "4.0", zoneOfProximalDevelopment: "3.2 - 5.1" } });
  });
  it.each(["PP", "P", "PHS"])("preserves the IRL code %s", (code) => {
    const applied = applyReportImport(request(source.replace("Level) 4.0", `Level) ${code}`)), workspace());
    expect(Object.values(applied.rows[0].assessmentValues!)).toEqual([60, code, "3.2 - 5.1"]);
  });
  it("recognizes later student score pages without the repeated document title", () => {
    const text = source.replace("Instructional Planning - Student Report Star Reading Enterprise", "");
    expect(document(text).students[0].issues).toEqual([]);
    expect(applyReportImport(request(text), workspace()).dataCellCount).toBe(3);
  });
  it.each(["Star Reading", "Star Read", "Star Reading Enterprise"])("recognizes the assessment alias %s", (name) => {
    expect(starAssessmentKind({ ...assessment, id: "custom-reading", name })).toBe("Star Reading");
  });
  it("matches full headings, field slugs and scoped columns without altering other scores", () => {
    const state = workspace();
    state.templates[0].yearDefinitions = { [selection.schoolYear]: { ...assessment, sections: [{ id: "results", name: "Reading results", roundIds: ["fall"] }], fields: [
      { ...fields[0], name: "PR (Percentile Rank)", sectionIds: ["results"] },
      { ...fields[1], name: "Instructional Reading Level", sectionIds: ["results"] },
      { ...fields[2], name: "ZPD (Zone of Proximal Development)", sectionIds: ["results"] },
      field("ss", "SS (Scaled Score)", "integer"), field("projected_ss", "Projected Scaled Score", "integer")
    ] } };
    state.rows[0].assessmentValues = { year_2026_2027__keep: 42, unrelated: 99 };
    const original = structuredClone(state);
    const applied = applyReportImport(request(), state);
    expect(applied.dataCellCount).toBe(5);
    expect(applied.rows[0].assessmentValues).toMatchObject({ year_2026_2027__keep: 42, unrelated: 99 });
    expect(Object.keys(applied.rows[0].assessmentValues!).filter((key) => key.startsWith("year_2025_2026__"))).toHaveLength(5);
    expect(applied.updatedRows[0].previousRow).toEqual(original.rows[0]);
    expect(state).toEqual(original);
    expect(applyReportImport(request(), { ...state, rows: applied.rows }).dataCellCount).toBe(0);
  });
  it("rejects Math PDFs for Reading, Reading PDFs for Math, and conflicting headings", () => {
    const state = workspace();
    expect(reviewReportImport([document(source.replaceAll("Star Reading", "Star Math"))], selection, state).rows[0].issues.join(" ")).toContain("PDF assessment is Star Math");
    state.templates[0].name = "Star Math";
    state.templates[0].fields = [fields[0]];
    expect(reviewReportImport([document()], selection, state).rows[0].issues.join(" ")).toContain("selected assessment is Star Math");
    expect(document(source.replace("Star Reading Enterprise Tests Results", "Star Math Enterprise Tests Results")).students[0].issues.join(" ")).toContain("does not match");
    expect(() => applyReportImport(request(), state)).toThrow("verified");
  });
  it("prefers a recognized current field heading over its older slug", () => {
    const state = workspace();
    state.templates[0].fields = [{ ...fields[1], slug: "pr" }];
    expect(Object.values(applyReportImport(request(), state).rows[0].assessmentValues!)).toEqual(["4.0"]);
  });
  it("skips a wrong-assessment page without invalidating a verified Reading page for the same student", () => {
    const docs = parseStarReportPdf([{ pageNumber: 1, text: source }, { pageNumber: 4, text: source.replaceAll("Star Reading", "Star Math") }], "mixed.pdf", "reading");
    const applied = applyReportImport({ selection, documents: [docs], selectedRowIds: ["reading:1", "reading:4"] }, workspace());
    expect(applied.reviewedRows.map((row) => row.id)).toEqual(["reading:1"]);
    expect(applied.dataCellCount).toBe(3);
  });
  it("flags missing reading values and incompatible configured data types instead of rounding", () => {
    expect(() => applyReportImport(request(source.replace("IRL (Instructional Reading Level) 4.0", "IRL unavailable")), workspace())).toThrow("verified");
    const state = workspace(); state.templates[0].fields[1].dataType = "integer";
    expect(reviewReportImport([document()], selection, state).rows[0].issues.join(" ")).toContain("whole number");
    state.templates[0].fields[1].dataType = "text"; state.templates[0].fields[2].dataType = "integer";
    expect(() => applyReportImport(request(), state)).toThrow("verified");
  });
  it("preserves decimal-zero suffixes as text and writes only the selected window", () => {
    const applied = applyReportImport(request(), workspace());
    expect(applied.rows[0].assessmentValues?.[assessmentValueKey(assessment, defaultRounds[0], fields[1], undefined, selection)]).toBe("4.0");
    expect(Object.keys(applied.rows[0].assessmentValues!).every((key) => key.includes("fall"))).toBe(true);
  });
  it("imports numeric IRL into a Float field but flags reading codes instead of coercing them", () => {
    const state = workspace();
    state.templates[0].fields[1].dataType = "float";
    const applied = applyReportImport(request(source.replace("Level) 4.0", "Level) 4.25")), state);
    expect(applied.rows[0].assessmentValues?.[assessmentValueKey(assessment, defaultRounds[0], fields[1], undefined, selection)]).toBe(4.25);
    expect(reviewReportImport([document(source.replace("Level) 4.0", "Level) PP"))], selection, state).rows[0].issues.join(" ")).toContain("IRL must be a number");
  });
  it("includes reading values and issue reasons in the skipped-rows CSV", () => {
    const state = workspace(); state.placements = [];
    const parsed = document();
    const report = reportAttentionCsv([parsed], selection, reviewReportImport([parsed], selection, state))!;
    const workbook = read(report.csv, { type: "string", raw: true });
    const rows = utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
    expect(rows[0].slice(-3)).toEqual(["Instructional Reading Level", "Zone of Proximal Development", "Needs Attention"]);
    expect(rows[1].slice(-3)).toEqual(["4.0", "3.2 - 5.1", "No matching student in Grade 4 for 2025-2026."]);
  });
});
