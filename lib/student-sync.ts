import type { OrfResultRow } from "@/lib/sample-results";

type StudentIdentityRow = Pick<OrfResultRow, "id" | "student">;

export function studentRowsNeedingSqlSync(
  previousRows: StudentIdentityRow[],
  nextRows: StudentIdentityRow[]
) {
  const previousNames = new Map(
    previousRows.map((row) => [row.id, normalizeStudentName(row.student)])
  );

  return nextRows.filter(
    (row) => previousNames.get(row.id) !== normalizeStudentName(row.student)
  );
}

function normalizeStudentName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
