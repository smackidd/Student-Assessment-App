import { describe, expect, it } from "vitest";
import {
  buildStudentSyncPlan,
  parseStudentSyncInput,
  studentSyncBatches,
  type SavedStudent
} from "../functions/src/student-sync";

function savedStudent(studentNumber: string): SavedStudent {
  return {
    id: `database-${studentNumber}`,
    firstName: "Saved",
    lastName: "Student",
    preferredName: null,
    studentNumber,
    active: true
  };
}

describe("server student synchronization", () => {
  it("assigns database keys to new bulk-upsert rows and preserves existing keys", () => {
    let nextId = 0;
    const plan = buildStudentSyncPlan(
      [
        { id: "existing", student: "Renamed Student" },
        { id: "new", student: "New Student" }
      ],
      [savedStudent("existing")],
      () => `generated-${++nextId}`
    );

    expect(plan.rows.map((row) => row.id)).toEqual(["database-existing", "generated-1"]);
    expect(plan.updatedCount).toBe(1);
    expect(plan.createdCount).toBe(1);
  });

  it("deduplicates request identifiers and splits 500 rows into bounded batches", () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      id: `student-${index + 1}`,
      student: `Synthetic Student ${index + 1}`
    }));
    const parsed = parseStudentSyncInput([...rows, rows[0]]);
    const plan = buildStudentSyncPlan(parsed, [], () => crypto.randomUUID());
    const batches = studentSyncBatches(plan.rows, 200);

    expect(parsed).toHaveLength(500);
    expect(batches.map((batch) => batch.length)).toEqual([200, 200, 100]);
    expect(new Set(plan.rows.map((row) => row.id)).size).toBe(500);
  });
});
