import { describe, expect, it } from "vitest";
import {
  ImportRollbackError,
  planImportRollback
} from "../functions/src/import-rollback";
import type { WorkspaceState } from "../functions/src/workspace-scope";

const importedRow = {
  id: "student-imported",
  student: "Imported Student",
  homeroom: "3A",
  assessmentValues: { fall_score: 12 }
};
const existingBefore = {
  id: "student-existing",
  student: "Existing Student",
  homeroom: "3A",
  assessmentValues: { fall_score: 8 }
};
const existingAfter = {
  ...existingBefore,
  assessmentValues: { fall_score: 14 }
};
const importedPlacement = {
  studentId: importedRow.id,
  schoolYear: "2026-2027",
  grade: "3",
  homeroom: "3A"
};
const existingPlacement = {
  studentId: existingBefore.id,
  schoolYear: "2026-2027",
  grade: "3",
  homeroom: "3A"
};

function workspace(): WorkspaceState {
  return {
    rows: [importedRow, existingAfter],
    placements: [importedPlacement, existingPlacement],
    templates: [],
    schoolYears: ["2026-2027"],
    pendingStudentSync: false,
    importLogs: [
      {
        id: "import-1",
        fileName: "class-list.xlsx",
        schoolYear: "2026-2027",
        grade: "3",
        createdAt: "2026-08-10T12:00:00.000Z",
        importedCount: 2,
        dataCellCount: 2,
        duplicateNames: [],
        addedStudentIds: [importedRow.id],
        addedRows: [importedRow],
        addedPlacements: [importedPlacement, existingPlacement],
        updatedRows: [
          {
            studentId: existingBefore.id,
            previousRow: existingBefore,
            nextRow: existingAfter
          }
        ]
      }
    ]
  };
}

describe("import rollback planning", () => {
  it("derives the inverse change set from the server-owned import snapshot", () => {
    const plan = planImportRollback(workspace(), "import-1", "2026-08-10T13:00:00.000Z");

    expect(plan.studentNumbers).toEqual([importedRow.id]);
    expect(plan.state.rows).toEqual([existingBefore]);
    expect(plan.state.placements).toEqual([]);
    expect(plan.state.pendingStudentSync).toBe(false);
    expect(plan.state.importLogs).toEqual([
      expect.objectContaining({ id: "import-1", revertedAt: "2026-08-10T13:00:00.000Z" })
    ]);
  });

  it("refuses to delete an imported student whose workspace row changed later", () => {
    const state = workspace();
    state.rows[0] = { ...state.rows[0], assessmentValues: { fall_score: 99 } };

    expect(() => planImportRollback(state, "import-1", "2026-08-10T13:00:00.000Z")).toThrow(
      "affected student record has changed since the import"
    );
  });

  it("accepts an unchanged imported row after JSON object keys are reordered", () => {
    const state = workspace();
    state.rows[0] = {
      student: importedRow.student,
      assessmentValues: importedRow.assessmentValues,
      homeroom: importedRow.homeroom,
      id: importedRow.id
    };

    expect(planImportRollback(state, "import-1", "2026-08-10T13:00:00.000Z").studentNumbers)
      .toEqual([importedRow.id]);
  });

  it("refuses an imported student who gained another placement", () => {
    const state = workspace();
    state.placements.push({ ...importedPlacement, schoolYear: "2027-2028" });

    expect(() => planImportRollback(state, "import-1", "2026-08-10T13:00:00.000Z")).toThrow(
      "an imported student placement changed after the import"
    );
  });

  it("refuses legacy logs that cannot prove the imported SQL row snapshot", () => {
    const state = workspace();
    const log = state.importLogs?.[0] as Record<string, unknown>;
    delete log.addedRows;

    expect(() => planImportRollback(state, "import-1", "2026-08-10T13:00:00.000Z")).toThrow(
      "rollback record is incomplete"
    );
  });

  it("makes a completed rollback unavailable for a second execution", () => {
    const state = workspace();
    (state.importLogs?.[0] as Record<string, unknown>).revertedAt = "2026-08-10T13:00:00.000Z";

    expect(() => planImportRollback(state, "import-1", "2026-08-10T14:00:00.000Z")).toThrowError(
      ImportRollbackError
    );
    expect(() => planImportRollback(state, "import-1", "2026-08-10T14:00:00.000Z")).toThrow(
      "already been reverted"
    );
  });
});
