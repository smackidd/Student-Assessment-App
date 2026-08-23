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

  it("creates contiguous year, window, and section header groups without crossing year boundaries", () => {
    const [block] = buildStudentReportBlocks([
      {
        assessmentId: "reading",
        assessmentName: "Reading",
        rows: [
          reportRow({ studentId: "student-a", assessmentId: "reading", fieldId: "wpm", field: "WPM", value: "40" }),
          reportRow({ studentId: "student-a", assessmentId: "reading", fieldId: "accuracy", field: "Accuracy", value: "90" }),
          reportRow({
            studentId: "student-a",
            assessmentId: "reading",
            fieldId: "wpm",
            field: "WPM",
            year: "2027-2028",
            value: "50"
          })
        ]
      }
    ]);

    expect(studentReportHeaderGroups(block.columns, "year").map(({ label, span }) => ({ label, span }))).toEqual([
      { label: "2026-2027", span: 2 },
      { label: "2027-2028", span: 1 }
    ]);
    expect(studentReportHeaderGroups(block.columns, "window").map(({ label, span }) => ({ label, span }))).toEqual([
      { label: "Fall", span: 2 },
      { label: "Fall", span: 1 }
    ]);
    expect(studentReportHeaderGroups(block.columns, "section").map(({ label, span }) => ({ label, span }))).toEqual([
      { label: "General", span: 2 },
      { label: "General", span: 1 }
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

  it("retains one selected-year no-data column when nobody has assessment data", () => {
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
          })
        ]
      }
    ]);

    expect(block.columns.map((column) => ({ year: column.year, field: column.field }))).toEqual([
      { year: "2027-2028", field: "No data" }
    ]);
  });

  it("keeps global year order when different students have data in different years", () => {
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

    expect(block.columns.map((column) => column.year)).toEqual(["2025-2026", "2026-2027"]);
    expect(block.rows.map((row) => row.studentId)).toEqual(["student-a", "student-a", "student-b", "student-b"]);
  });
});

describe("student report worksheet layout", () => {
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
    expect(layout.rows[1].slice(0, 4)).toEqual(["Assessment Year", "", "", "2026-2027"]);
    expect(layout.rows[5].slice(0, 4)).toEqual(["Alex Smith", "3", "3A", "42"]);
    expect(layout.rows[6]).toEqual([]);
    expect(layout.rows[7][0]).toBe("Writing");
    expect(layout.rows[12].slice(0, 4)).toEqual(["Alex Smith", "3", "3A", "Strong"]);
    expect(layout.blocks.map((block) => block.titleRow)).toEqual([0, 7]);
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

    expect(layout.merges).toContainEqual({ startRow: 0, startColumn: 0, endRow: 0, endColumn: 4 });
    expect(layout.merges).toContainEqual({ startRow: 1, startColumn: 3, endRow: 1, endColumn: 4 });
    expect(layout.merges).toContainEqual({ startRow: 2, startColumn: 3, endRow: 2, endColumn: 4 });
    expect(layout.merges).toContainEqual({ startRow: 3, startColumn: 3, endRow: 3, endColumn: 4 });
  });
});
