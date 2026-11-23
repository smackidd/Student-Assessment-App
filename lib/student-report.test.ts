import { describe, expect, it } from "vitest";
import type { StudentIdentityOption } from "@/lib/overview-state";
import {
  addReportStudentId,
  buildStudentReportBlocks,
  buildStudentReportWorksheetLayout,
  matchingReportStudentOptions,
  reconcileReportStudentIds,
  removeReportStudentId,
  STUDENT_REPORT_NO_DATA_ID,
  studentReportHeaderGroups,
  type StudentReportSourceRow
} from "@/lib/student-report";

const studentOptions: StudentIdentityOption[] = [
  {
    id: "student-a",
    name: "Alex Smith",
    detail: "2026-2027, Grade 3, 3A; 2025-2026, Grade 2, 2B"
  },
  {
    id: "student-b",
    name: "Alex Smith",
    detail: "2026-2027, Grade 4, 4A"
  },
  {
    id: "student-c",
    name: "Jordan Lee",
    detail: "2026-2027, Grade 3, 3B"
  }
];

describe("student report selection", () => {
  it("adds a stable student ID once and preserves selection order", () => {
    expect(addReportStudentId(["student-c"], "student-a")).toEqual(["student-c", "student-a"]);
    expect(addReportStudentId(["student-c", "student-a"], "student-a")).toEqual(["student-c", "student-a"]);
  });

  it("removes only the requested student", () => {
    expect(removeReportStudentId(["student-a", "student-b"], "student-a")).toEqual(["student-b"]);
  });

  it("drops stale and duplicate IDs while keeping same-name students distinct", () => {
    expect(
      reconcileReportStudentIds(["student-a", "missing", "student-b", "student-a"], studentOptions)
    ).toEqual(["student-a", "student-b"]);
  });

  it("searches names and placement context while excluding selected students", () => {
    expect(matchingReportStudentOptions(studentOptions, ["student-a"], "alex").map((option) => option.id)).toEqual([
      "student-b"
    ]);
    expect(matchingReportStudentOptions(studentOptions, [], "grade 2").map((option) => option.id)).toEqual([
      "student-a"
    ]);
  });

  it("returns both same-name identities and respects the result limit", () => {
    expect(matchingReportStudentOptions(studentOptions, [], "Alex Smith").map((option) => option.id)).toEqual([
      "student-a",
      "student-b"
    ]);
    expect(matchingReportStudentOptions(studentOptions, [], "", 2)).toHaveLength(2);
  });
});

function reportRow(
  patch: Partial<StudentReportSourceRow> & Pick<StudentReportSourceRow, "studentId" | "assessmentId" | "fieldId" | "value">
): StudentReportSourceRow {
  return {
    studentId: patch.studentId,
    student: patch.student ?? "Alex Smith",
    year: patch.year ?? "2026-2027",
    grade: patch.grade ?? "3",
    homeroom: patch.homeroom ?? "3A",
    assessmentId: patch.assessmentId,
    assessment: patch.assessment ?? "Assessment",
    roundId: patch.roundId ?? "fall",
    window: patch.window ?? "Fall",
    windowColor: patch.windowColor ?? "#ffe3d8",
    sectionId: patch.sectionId ?? "general",
    section: patch.section ?? "General",
    fieldId: patch.fieldId,
    field: patch.field ?? "Score",
    value: patch.value
  };
}

describe("student report blocks", () => {
  it("keeps same-labelled fields from different assessments in independent blocks", () => {
    const blocks = buildStudentReportBlocks([
      {
        assessmentId: "reading",
        assessmentName: "Reading",
        rows: [reportRow({ studentId: "student-a", assessmentId: "reading", fieldId: "score", value: "42" })]
      },
      {
        assessmentId: "writing",
        assessmentName: "Writing",
        rows: [reportRow({ studentId: "student-a", assessmentId: "writing", fieldId: "score", value: "Excellent" })]
      }
    ]);

    expect(blocks.map((block) => block.assessmentId)).toEqual(["reading", "writing"]);
    expect(blocks[0].rows[0].values[blocks[0].columns[0].key]).toBe("42");
    expect(blocks[1].rows[0].values[blocks[1].columns[0].key]).toBe("Excellent");
    expect(blocks[0].columns[0].key).not.toBe(blocks[1].columns[0].key);
  });

  it("uses stable IDs so duplicate display labels within one assessment do not collide", () => {
    const [block] = buildStudentReportBlocks([
      {
        assessmentId: "reading",
        assessmentName: "Reading",
        rows: [
          reportRow({ studentId: "student-a", assessmentId: "reading", fieldId: "accuracy-a", value: "80", field: "Accuracy" }),
          reportRow({ studentId: "student-a", assessmentId: "reading", fieldId: "accuracy-b", value: "90", field: "Accuracy" })
        ]
      }
    ]);

    expect(block.columns).toHaveLength(2);
    expect(block.columns.map((column) => column.field)).toEqual(["Accuracy", "Accuracy"]);
    expect(block.columns.map((column) => block.rows[0].values[column.key])).toEqual(["80", "90"]);
  });

  it("keeps same-name students distinct and preserves selected-student and year order", () => {
    const [block] = buildStudentReportBlocks([
      {
        assessmentId: "reading",
        assessmentName: "Reading",
        rows: [
          reportRow({ studentId: "student-b", student: "Alex Smith", assessmentId: "reading", fieldId: "score", value: "55" }),
          reportRow({
            studentId: "student-a",
            student: "Alex Smith",
            assessmentId: "reading",
            fieldId: "score",
            year: "2025-2026",
            grade: "2",
            homeroom: "2B",
            value: "44"
          })
        ]
      }
    ]);

    expect(block.rows.map((row) => row.key)).toEqual([
      "student-b|2026-2027|3|3A",
      "student-a|2025-2026|2|2B"
    ]);
    expect(block.rows.map((row) => row.student)).toEqual(["Alex Smith", "Alex Smith"]);
  });

  it("aligns each student's years under shared window, section, and field columns", () => {
    const rows = ["2025-2026", "2026-2027", "2027-2028"].flatMap((year, index) => [
      reportRow({ studentId: "student-a", assessmentId: "reading", year, grade: String(index + 2),
        homeroom: String(index + 2) + "A", fieldId: "wpm", field: "WPM", value: String(40 + index * 10) }),
      reportRow({ studentId: "student-a", assessmentId: "reading", year, grade: String(index + 2),
        homeroom: String(index + 2) + "A", fieldId: "accuracy", field: "Accuracy", value: String(90 + index) }),
      reportRow({ studentId: "student-a", assessmentId: "reading", year, grade: String(index + 2),
        homeroom: String(index + 2) + "A", roundId: "winter", window: "Winter",
        fieldId: "wpm", field: "WPM", value: String(45 + index * 10) })
    ]);
    const [block] = buildStudentReportBlocks([{ assessmentId: "reading", assessmentName: "Reading", rows }]);

    expect(block.columns).toHaveLength(3);
    expect(block.rows.map((row) => row.year)).toEqual(["2025-2026", "2026-2027", "2027-2028"]);
    expect(block.rows.map((row) => block.columns.map((column) => row.values[column.key]))).toEqual([
      ["40", "90", "45"], ["50", "91", "55"], ["60", "92", "65"]
    ]);
    expect(studentReportHeaderGroups(block.columns, "window").map(({ label, span }) => ({ label, span }))).toEqual([
      { label: "Fall", span: 2 }, { label: "Winter", span: 1 }
    ]);
    expect(studentReportHeaderGroups(block.columns, "section").map(({ label, span }) => ({ label, span }))).toEqual([
      { label: "General", span: 2 }, { label: "General", span: 1 }
    ]);
  });

  it("keeps newly introduced fields beside their existing window and section", () => {
    const [block] = buildStudentReportBlocks([{
      assessmentId: "reading", assessmentName: "Reading", rows: [
        reportRow({ studentId: "student-a", assessmentId: "reading", year: "2025-2026",
          fieldId: "wpm", field: "WPM", value: "40" }),
        reportRow({ studentId: "student-a", assessmentId: "reading", year: "2025-2026",
          roundId: "winter", window: "Winter", fieldId: "wpm", field: "WPM", value: "45" }),
        reportRow({ studentId: "student-a", assessmentId: "reading", year: "2026-2027",
          fieldId: "wpm", field: "WPM", value: "50" }),
        reportRow({ studentId: "student-a", assessmentId: "reading", year: "2026-2027",
          fieldId: "accuracy", field: "Accuracy", value: "90" }),
        reportRow({ studentId: "student-a", assessmentId: "reading", year: "2026-2027",
          sectionId: "comprehension", section: "Comprehension", fieldId: "score", value: "8" }),
        reportRow({ studentId: "student-a", assessmentId: "reading", year: "2026-2027",
          roundId: "winter", window: "Winter", fieldId: "wpm", field: "WPM", value: "55" })
      ]
    }]);

    expect(block.columns.map(({ roundId, sectionId, fieldId }) => [roundId, sectionId, fieldId])).toEqual([
      ["fall", "general", "wpm"], ["fall", "general", "accuracy"],
      ["fall", "comprehension", "score"], ["winter", "general", "wpm"]
    ]);
    expect(block.rows.map((row) => block.columns.map((column) => row.values[column.key] ?? ""))).toEqual([
      ["40", "", "", "45"], ["50", "90", "8", "55"]
    ]);
  });

  it("keeps every selected student row without adding a no-data column when another student has year data", () => {
    const [block] = buildStudentReportBlocks([
      {
        assessmentId: "reading",
        assessmentName: "Reading",
        rows: [
          reportRow({
            studentId: "student-a",
            assessmentId: "reading",
            roundId: STUDENT_REPORT_NO_DATA_ID,
            window: "No data",
            sectionId: STUDENT_REPORT_NO_DATA_ID,
            section: "No data",
            fieldId: STUDENT_REPORT_NO_DATA_ID,
            field: "No data",
            value: ""
          }),
          reportRow({ studentId: "student-b", assessmentId: "reading", fieldId: "score", value: "55" })
        ]
      }
    ]);

    expect(block.rows.map((row) => row.studentId)).toEqual(["student-a", "student-b"]);
    expect(block.columns.map((column) => column.field)).toEqual(["Score"]);
  });

  it("shares one no-data column across years when nobody has assessment data", () => {
    const [block] = buildStudentReportBlocks([
      {
        assessmentId: "reading",
        assessmentName: "Reading",
        rows: [
          reportRow({
            studentId: "student-a",
            assessmentId: "reading",
            year: "2027-2028",
            roundId: STUDENT_REPORT_NO_DATA_ID,
            window: "No data",
            sectionId: STUDENT_REPORT_NO_DATA_ID,
            section: "No data",
            fieldId: STUDENT_REPORT_NO_DATA_ID,
            field: "No data",
            value: ""
          }),
          reportRow({ studentId: "student-a", assessmentId: "reading", year: "2028-2029",
            roundId: STUDENT_REPORT_NO_DATA_ID, window: "No data", sectionId: STUDENT_REPORT_NO_DATA_ID,
            section: "No data", fieldId: STUDENT_REPORT_NO_DATA_ID, field: "No data", value: "" })
        ]
      }
    ]);

    expect(block.columns.map((column) => column.field)).toEqual(["No data"]);
    expect(block.rows.map((row) => row.year)).toEqual(["2027-2028", "2028-2029"]);
  });

  it("preserves student-year rows and shared columns when data is missing in different years", () => {
    const noData = (studentId: string, year: string) => reportRow({
      studentId,
      assessmentId: "reading",
      year,
      roundId: STUDENT_REPORT_NO_DATA_ID,
      window: "No data",
      sectionId: STUDENT_REPORT_NO_DATA_ID,
      section: "No data",
      fieldId: STUDENT_REPORT_NO_DATA_ID,
      field: "No data",
      value: ""
    });
    const [block] = buildStudentReportBlocks([
      {
        assessmentId: "reading",
        assessmentName: "Reading",
        rows: [
          noData("student-a", "2025-2026"),
          reportRow({ studentId: "student-a", assessmentId: "reading", year: "2026-2027", fieldId: "score", value: "55" }),
          reportRow({ studentId: "student-b", assessmentId: "reading", year: "2025-2026", fieldId: "score", value: "44" }),
          noData("student-b", "2026-2027")
        ]
      }
    ]);

    expect(block.columns.map((column) => column.field)).toEqual(["Score"]);
    expect(block.rows.map((row) => [row.studentId, row.year])).toEqual([
      ["student-a", "2025-2026"], ["student-a", "2026-2027"],
      ["student-b", "2025-2026"], ["student-b", "2026-2027"]
    ]);
    expect(block.rows.map((row) => block.columns.map((column) => row.values[column.key] ?? ""))).toEqual([
      [""], ["55"], ["44"], [""]
    ]);
  });
});

describe("student report worksheet layout", () => {
  it("exports every attendance year into the same assessment columns", () => {
    const [block] = buildStudentReportBlocks([{
      assessmentId: "reading", assessmentName: "Reading", rows: [
        reportRow({ studentId: "student-a", assessmentId: "reading", year: "2025-2026",
          grade: "2", homeroom: "2B", fieldId: "score", value: "44" }),
        reportRow({ studentId: "student-a", assessmentId: "reading", year: "2026-2027",
          fieldId: "score", value: "55" })
      ]
    }]);
    const layout = buildStudentReportWorksheetLayout([block]);

    expect(layout.blocks[0].columnCount).toBe(5);
    expect(layout.rows[3]).toEqual(["Student", "Grade", "Homeroom", "Year", "Score"]);
    expect(layout.rows[4]).toEqual(["Alex Smith", "2", "2B", "2025-2026", "44"]);
    expect(layout.rows[5]).toEqual(["Alex Smith", "3", "3A", "2026-2027", "55"]);
    expect(layout.rows.every((row) => row.length === 5)).toBe(true);
    expect(layout.rows.flat()).not.toContain("Assessment Year");
  });

  it("stacks assessment blocks on one sheet with repeated headers and a blank separator", () => {
    const blocks = buildStudentReportBlocks([
      {
        assessmentId: "reading",
        assessmentName: "Reading",
        rows: [reportRow({ studentId: "student-a", assessmentId: "reading", fieldId: "score", value: "42" })]
      },
      {
        assessmentId: "writing",
        assessmentName: "Writing",
        rows: [reportRow({ studentId: "student-a", assessmentId: "writing", fieldId: "score", value: "Strong" })]
      }
    ]);
    const layout = buildStudentReportWorksheetLayout(blocks);

    expect(layout.blocks).toHaveLength(2);
    expect(layout.rows[0][0]).toBe("Reading");
    expect(layout.rows[1].slice(0, 5)).toEqual(["Assessment Window", "", "", "", "Fall"]);
    expect(layout.rows[3].slice(0, 5)).toEqual(["Student", "Grade", "Homeroom", "Year", "Score"]);
    expect(layout.rows[4].slice(0, 5)).toEqual(["Alex Smith", "3", "3A", "2026-2027", "42"]);
    expect(layout.rows[5]).toEqual([]);
    expect(layout.rows[6][0]).toBe("Writing");
    expect(layout.rows[10].slice(0, 5)).toEqual(["Alex Smith", "3", "3A", "2026-2027", "Strong"]);
    expect(layout.blocks.map((block) => block.titleRow)).toEqual([0, 6]);
  });

  it("creates block-local title and grouped-header merges", () => {
    const [block] = buildStudentReportBlocks([
      {
        assessmentId: "reading",
        assessmentName: "Reading",
        rows: [
          reportRow({ studentId: "student-a", assessmentId: "reading", fieldId: "wpm", field: "WPM", value: "40" }),
          reportRow({ studentId: "student-a", assessmentId: "reading", fieldId: "accuracy", field: "Accuracy", value: "90" })
        ]
      }
    ]);
    const layout = buildStudentReportWorksheetLayout([block]);

    expect(layout.merges).toContainEqual({ startRow: 0, startColumn: 0, endRow: 0, endColumn: 5 });
    expect(layout.merges).toContainEqual({ startRow: 1, startColumn: 4, endRow: 1, endColumn: 5 });
    expect(layout.merges).toContainEqual({ startRow: 2, startColumn: 4, endRow: 2, endColumn: 5 });
  });
});
