import { describe, expect, it } from "vitest";
import { buildStudentSavePlan, runInBatches, type PersistedStudent } from "./student-save-planner";

function savedStudent(
  studentNumber: string,
  firstName: string,
  lastName: string,
  preferredName: string | null = null
): PersistedStudent {
  return {
    id: `database-${studentNumber}`,
    firstName,
    lastName,
    preferredName,
    studentNumber,
    active: true
  };
}

describe("student SQL save planning", () => {
  it("skips unchanged students and creates or updates only the changed rows", () => {
    const plan = buildStudentSavePlan(
      [
        { id: "student-1", student: "Ada Lovelace" },
        { id: "student-2", student: "Grace Murray Hopper" },
        { id: "student-3", student: "Katherine Johnson" }
      ],
      [
        savedStudent("student-1", "Ada", "Lovelace"),
        savedStudent("student-2", "Grace", "Hopper")
      ]
    );

    expect(plan.skippedCount).toBe(1);
    expect(plan.actions).toEqual([
      {
        kind: "update",
        studentNumber: "student-2",
        variables: {
          studentId: "database-student-2",
          firstName: "Grace Murray",
          lastName: "Hopper",
          preferredName: null
        }
      },
      {
        kind: "create",
        studentNumber: "student-3",
        variables: {
          firstName: "Katherine",
          lastName: "Johnson",
          preferredName: null,
          studentNumber: "student-3"
        }
      }
    ]);
  });

  it("preserves a matching preferred display name and deduplicates repeated row ids", () => {
    const plan = buildStudentSavePlan(
      [
        { id: "student-1", student: "Katie" },
        { id: "student-1", student: "Katie" }
      ],
      [savedStudent("student-1", "Katherine", "Johnson", "Katie")]
    );

    expect(plan.actions).toEqual([]);
    expect(plan.skippedCount).toBe(2);
  });

  it("bounds concurrent writes and waits for each batch before starting the next", async () => {
    let active = 0;
    let maximumActive = 0;
    const startOrder: number[] = [];

    const results = await runInBatches([1, 2, 3, 4, 5], 2, async (item) => {
      startOrder.push(item);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      active -= 1;
      return item * 10;
    });

    expect(startOrder).toEqual([1, 2, 3, 4, 5]);
    expect(maximumActive).toBe(2);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("rejects an invalid batch size", async () => {
    await expect(runInBatches([1], 0, async (item) => item)).rejects.toThrow("positive whole number");
  });
});
