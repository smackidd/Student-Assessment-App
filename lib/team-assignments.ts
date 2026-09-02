import type { StudentPlacement } from "@/lib/overview-state";
import type { TeamMember, UserRole } from "@/lib/organization-auth";

export const SUPPORTED_GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;

export function latestSchoolYear(schoolYears: string[]) {
  return [...schoolYears].sort((left, right) => schoolYearStart(right) - schoolYearStart(left))[0] ?? "";
}

export function teamAssignmentHomerooms(placements: StudentPlacement[], schoolYear: string) {
  const assignments: Record<string, string[]> = Object.fromEntries(
    SUPPORTED_GRADES.map((grade) => [grade, []])
  );
  if (!schoolYear) return assignments;

  for (const placement of placements) {
    const homeroom = placement.homeroom.trim();
    if (placement.schoolYear !== schoolYear || !homeroom) continue;
    const homerooms = assignments[placement.grade] ?? (assignments[placement.grade] = []);
    if (!homerooms.includes(homeroom)) homerooms.push(homeroom);
  }
  for (const homerooms of Object.values(assignments)) homerooms.sort();
  return assignments;
}

export function resolveTeamMemberAccess(
  member: TeamMember,
  patch: Partial<Pick<TeamMember, "role" | "grade" | "homeroom">>,
  assignmentHomerooms: Record<string, string[]>
): { role: UserRole; grade: string; homeroom: string } {
  const role = patch.role ?? member.role;
  if (role === "Admin") return { role, grade: "", homeroom: "" };

  const assignmentGrades = Object.keys(assignmentHomerooms)
    .sort((left, right) => Number(left) - Number(right));
  const firstAssignedGrade = assignmentGrades.find(
    (gradeOption) => assignmentHomerooms[gradeOption].length > 0
  ) ?? assignmentGrades[0] ?? "";
  const grade = (patch.grade ?? member.grade) || firstAssignedGrade;
  const requestedHomeroom = patch.homeroom ?? member.homeroom;
  const homeroom = requestedHomeroom && assignmentHomerooms[grade]?.includes(requestedHomeroom)
    ? requestedHomeroom
    : "";
  return { role, grade, homeroom };
}

function schoolYearStart(year: string) {
  const start = Number(year.split("-")[0]);
  return Number.isFinite(start) ? start : Number.NEGATIVE_INFINITY;
}
