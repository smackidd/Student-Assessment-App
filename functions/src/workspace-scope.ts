export type WorkspaceAssessmentValue = string | number | null;

export type WorkspaceRow = {
  id: string;
  homeroom: string;
  student: string;
  assessmentValues?: Record<string, WorkspaceAssessmentValue>;
  [key: string]: unknown;
};

export type WorkspacePlacement = {
  studentId: string;
  schoolYear: string;
  grade: string;
  homeroom: string;
};

type WorkspaceField = {
  id: string;
  name: string;
  dataType: string;
  roundIds?: string[];
  sectionIds?: string[];
  isCalculated: boolean;
  visibility: "evaluators" | "vice-principal" | "admin";
  [key: string]: unknown;
};

type WorkspaceRound = {
  id: string;
  label: string;
  [key: string]: unknown;
};

type WorkspaceSection = {
  id: string;
  name: string;
  roundIds: string[];
  [key: string]: unknown;
};

export type WorkspaceTemplate = {
  id: string;
  name: string;
  gradeScope: string;
  rounds: WorkspaceRound[];
  sections?: WorkspaceSection[];
  fields: WorkspaceField[];
  [key: string]: unknown;
};

export type WorkspaceState = {
  rows: WorkspaceRow[];
  placements: WorkspacePlacement[];
  templates: WorkspaceTemplate[];
  schoolYears: string[];
  lockedOverviewYears?: string[];
  pendingStudentSync?: boolean;
  currentUserRole?: "Admin" | "Teacher / EA";
  userProfile?: {
    name: string;
    email: string;
    grade: string;
    homeroom: string;
  };
  teamMembers?: unknown[];
  auditEvents?: unknown[];
  importLogs?: unknown[];
  [key: string]: unknown;
};

export type WorkspaceAccess = {
  uid: string;
  role: "admin" | "teacher_ea";
  displayName: string;
  email: string;
  grade: string;
  homeroom: string;
};

export type WorkspaceScopeErrorCode = "failed-precondition" | "invalid-argument" | "permission-denied";

export class WorkspaceScopeError extends Error {
  constructor(readonly code: WorkspaceScopeErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceScopeError";
  }
}

export function parseWorkspaceState(value: unknown): WorkspaceState {
  if (!isRecord(value)) throw new WorkspaceScopeError("invalid-argument", "The workspace payload is invalid.");
  const rows = value.rows;
  const placements = value.placements;
  const templates = value.templates;
  const schoolYears = value.schoolYears;
  if (!Array.isArray(rows) || !Array.isArray(placements) || !Array.isArray(templates) || !isStringArray(schoolYears)) {
    throw new WorkspaceScopeError("invalid-argument", "The workspace payload is incomplete.");
  }
  if (!rows.every(isWorkspaceRow) || !placements.every(isWorkspacePlacement) || !templates.every(isWorkspaceTemplate)) {
    throw new WorkspaceScopeError("invalid-argument", "The workspace payload contains invalid records.");
  }
  assertUniqueStudentYears(placements);
  return value as WorkspaceState;
}

function assertUniqueStudentYears(placements: WorkspacePlacement[]) {
  const seen = new Set<string>();
  for (const placement of placements) {
    const key = [placement.studentId, placement.schoolYear].join("\u001f");
    if (seen.has(key)) {
      throw new WorkspaceScopeError(
        "invalid-argument",
        "A student cannot appear more than once in the same school year."
      );
    }
    seen.add(key);
  }
}

export function scopeWorkspaceForAccess(state: WorkspaceState, access: WorkspaceAccess): WorkspaceState {
  if (access.role === "admin") return compactAdminWorkspace(state);
  const scope = teacherScope(state, access);
  const scopedTemplates = scope.templates.map((template) => ({
    ...template,
    fields: template.fields.filter((field) => field.visibility === "evaluators")
  }));
  const rowsById = new Map(state.rows.map((row) => [row.id, row]));
  const scopedRows = scope.placements
    .map((placement) => rowsById.get(placement.studentId))
    .filter((row): row is WorkspaceRow => Boolean(row))
    .map((row) => ({
      ...row,
      homeroom: access.homeroom,
      assessmentValues: filterValues(row.assessmentValues, scope.visibleKeys),
      septP1Wpm: null,
      septP1Epm: null,
      septP2Wpm: null,
      septP2Epm: null,
      septP3Wpm: null,
      septP3Epm: null,
      septP1Cwpm: null,
      septP2Cwpm: null,
      septP3Cwpm: null,
      septMedian: null,
      septPercentile: null
    }));

  return {
    rows: scopedRows,
    placements: scope.placements,
    templates: scopedTemplates,
    schoolYears: [scope.schoolYear],
    lockedOverviewYears: state.lockedOverviewYears?.includes(scope.schoolYear) ? [scope.schoolYear] : [],
    pendingStudentSync: false,
    currentUserRole: "Teacher / EA",
    userProfile: {
      name: access.displayName,
      email: access.email,
      grade: access.grade,
      homeroom: access.homeroom
    },
    teamMembers: [],
    auditEvents: [],
    importLogs: []
  };
}

export function mergeWorkspaceForAccess(
  current: WorkspaceState | null,
  proposed: WorkspaceState,
  access: WorkspaceAccess
): WorkspaceState {
  if (access.role === "admin") return mergeAdminWorkspace(current, proposed);
  if (!current) {
    throw new WorkspaceScopeError("failed-precondition", "An Admin must initialize the workspace before evaluators can save results.");
  }

  const scope = teacherScope(current, access);
  assertExactScopedRows(proposed, current, scope.placements, access);
  const proposedById = new Map(proposed.rows.map((row) => [row.id, row]));
  const authorizedStudentIds = new Set(scope.placements.map((placement) => placement.studentId));
  const rows = current.rows.map((row) => {
    if (!authorizedStudentIds.has(row.id)) return row;
    const proposedRow = proposedById.get(row.id);
    if (!proposedRow) return row;
    const nextValues = { ...(row.assessmentValues ?? {}) };
    for (const [key, value] of Object.entries(proposedRow.assessmentValues ?? {})) {
      if (!scope.visibleKeys.has(key)) {
        throw new WorkspaceScopeError("permission-denied", "The save contained an assessment value outside the assigned scope.");
      }
      if (!scope.writableKeys.has(key)) {
        if (!sameValue(value, row.assessmentValues?.[key])) {
          throw new WorkspaceScopeError("permission-denied", "Calculated or restricted assessment values cannot be changed.");
        }
        continue;
      }
      assertAssessmentValue(value);
      nextValues[key] = value;
    }
    return { ...row, assessmentValues: nextValues };
  });

  return { ...current, rows, pendingStudentSync: current.pendingStudentSync ?? false };
}

function compactAdminWorkspace(state: WorkspaceState): WorkspaceState {
  if (!Array.isArray(state.importLogs)) return state;
  return {
    ...state,
    importLogs: state.importLogs.map((log) => {
      if (!isRecord(log)) return log;
      return {
        ...log,
        addedStudentIds: [],
        addedRows: [],
        addedPlacements: [],
        updatedRows: []
      };
    })
  };
}

function mergeAdminWorkspace(current: WorkspaceState | null, proposed: WorkspaceState): WorkspaceState {
  if (!current || !Array.isArray(current.importLogs)) return proposed;

  const proposedLogs = Array.isArray(proposed.importLogs) ? proposed.importLogs : [];
  const currentLogsById = new Map(
    current.importLogs
      .map((log) => [recordId(log), log] as const)
      .filter((entry): entry is [string, unknown] => Boolean(entry[0]))
  );
  const proposedIds = new Set(proposedLogs.map(recordId).filter((id): id is string => Boolean(id)));
  const importLogs = proposedLogs.map((log) => {
    const id = recordId(log);
    return id && currentLogsById.has(id) ? currentLogsById.get(id) : log;
  });

  for (const log of current.importLogs) {
    const id = recordId(log);
    if (!id || !proposedIds.has(id)) importLogs.push(log);
  }

  return { ...proposed, importLogs };
}

function recordId(value: unknown) {
  return isRecord(value) && typeof value.id === "string" && value.id.trim() ? value.id : null;
}

function teacherScope(state: WorkspaceState, access: WorkspaceAccess) {
  if (!access.grade || !access.homeroom) {
    throw new WorkspaceScopeError("failed-precondition", "Teacher / EA access requires an assigned grade and home room.");
  }
  const schoolYear = state.schoolYears[0]?.trim();
  if (!schoolYear) {
    throw new WorkspaceScopeError("failed-precondition", "An Admin must configure the current school year before evaluators can continue.");
  }
  const placements = state.placements.filter(
    (placement) =>
      placement.schoolYear === schoolYear
      && placement.grade === access.grade
      && placement.homeroom === access.homeroom
  );
  const templates = state.templates.filter(
    (template) => assessmentSupportsGrade(template.gradeScope, access.grade)
      && template.fields.some((field) => field.visibility === "evaluators")
  );
  const visibleKeys = assessmentValueKeys(templates, schoolYear, access.grade, false);
  const writableKeys = assessmentValueKeys(templates, schoolYear, access.grade, true);
  return { schoolYear, placements, templates, visibleKeys, writableKeys };
}

function assessmentValueKeys(
  templates: WorkspaceTemplate[],
  schoolYear: string,
  grade: string,
  writableOnly: boolean
) {
  const keys = new Set<string>();
  const prefix = [schoolYear ? `year_${schoolYear}` : "", grade ? `grade_${grade}` : ""]
    .filter(Boolean)
    .map(slugForAssessmentKey)
    .join("__");

  for (const assessment of templates) {
    for (const round of assessment.rounds) {
      const sectionsForRound = (assessment.sections ?? []).filter(
        (section) => !section.roundIds.length || section.roundIds.includes(round.id)
      );
      for (const field of assessment.fields) {
        if (field.visibility !== "evaluators") continue;
        if (writableOnly && (field.isCalculated || field.dataType === "calculated")) continue;
        if (field.roundIds?.length && !field.roundIds.includes(round.id)) continue;
        let fieldSections = field.sectionIds?.length
          ? sectionsForRound.filter((section) => field.sectionIds?.includes(section.id))
          : [];
        if (!fieldSections.length && field.sectionIds?.length && assessment.id === "orf") {
          fieldSections = sectionsForRound;
        }
        if (!fieldSections.length) {
          addAssessmentKeys(keys, prefix, assessment, round, field);
          continue;
        }
        for (const section of fieldSections) {
          addAssessmentKeys(keys, prefix, assessment, round, field, section);
        }
      }
    }
  }
  return keys;
}

function addAssessmentKeys(
  keys: Set<string>,
  prefix: string,
  assessment: WorkspaceTemplate,
  round: WorkspaceRound,
  field: WorkspaceField,
  section?: WorkspaceSection
) {
  const variants = [
    [labelWithId(assessment.name, assessment.id), labelWithId(round.label, round.id), section ? labelWithId(section.name, section.id) : "", labelWithId(field.name, field.id)],
    [assessment.name, round.label, section?.name ?? "", field.name]
  ];
  for (const parts of variants) {
    const key = parts.filter(Boolean).map(slugForAssessmentKey).join("__");
    keys.add(prefix ? `${prefix}__${key}` : key);
  }
}

function assessmentSupportsGrade(gradeScope: string, assignedGrade: string) {
  const assigned = Number(assignedGrade.match(/\d+/)?.[0]);
  if (!Number.isSafeInteger(assigned)) return false;
  const range = gradeScope.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) {
    const minimum = Number(range[1]);
    const maximum = Number(range[2]);
    return assigned >= Math.min(minimum, maximum) && assigned <= Math.max(minimum, maximum);
  }
  return (gradeScope.match(/\d+/g) ?? []).map(Number).includes(assigned);
}

function assertExactScopedRows(
  proposed: WorkspaceState,
  current: WorkspaceState,
  authorizedPlacements: WorkspacePlacement[],
  access: WorkspaceAccess
) {
  const authorizedIds = new Set(authorizedPlacements.map((placement) => placement.studentId));
  const proposedIds = new Set(proposed.rows.map((row) => row.id));
  if (authorizedIds.size !== proposedIds.size || [...proposedIds].some((id) => !authorizedIds.has(id))) {
    throw new WorkspaceScopeError("permission-denied", "Students cannot be added to or removed from an evaluator save.");
  }
  const currentById = new Map(current.rows.map((row) => [row.id, row]));
  for (const row of proposed.rows) {
    const currentRow = currentById.get(row.id);
    if (!currentRow || row.student !== currentRow.student || row.homeroom !== access.homeroom) {
      throw new WorkspaceScopeError("permission-denied", "Student identity and home room fields are read-only for evaluators.");
    }
  }
  const expectedPlacements = new Set(authorizedPlacements.map(placementKey));
  const proposedPlacements = new Set(proposed.placements.map(placementKey));
  if (expectedPlacements.size !== proposedPlacements.size || [...proposedPlacements].some((key) => !expectedPlacements.has(key))) {
    throw new WorkspaceScopeError("permission-denied", "Student placements are read-only for evaluators.");
  }
}

function filterValues(values: Record<string, WorkspaceAssessmentValue> | undefined, allowed: Set<string>) {
  return Object.fromEntries(Object.entries(values ?? {}).filter(([key]) => allowed.has(key)));
}

function assertAssessmentValue(value: unknown): asserts value is WorkspaceAssessmentValue {
  if (value === null) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string" && value.length <= 20_000) return;
  throw new WorkspaceScopeError("invalid-argument", "The assessment value is invalid.");
}

function placementKey(placement: WorkspacePlacement) {
  return [placement.studentId, placement.schoolYear, placement.grade, placement.homeroom].join("\u001f");
}

function sameValue(left: unknown, right: unknown) {
  return Object.is(left, right);
}

function labelWithId(label: string, id: string) {
  return `${label} ${id}`;
}

function slugForAssessmentKey(value: string) {
  return value.trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "untitled";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isWorkspaceRow(value: unknown): value is WorkspaceRow {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.student !== "string" || typeof value.homeroom !== "string") return false;
  if (value.assessmentValues === undefined) return true;
  return isRecord(value.assessmentValues) && Object.values(value.assessmentValues).every(
    (item) => item === null || typeof item === "string" || (typeof item === "number" && Number.isFinite(item))
  );
}

function isWorkspacePlacement(value: unknown): value is WorkspacePlacement {
  return isRecord(value)
    && typeof value.studentId === "string"
    && typeof value.schoolYear === "string"
    && typeof value.grade === "string"
    && typeof value.homeroom === "string";
}

function isWorkspaceTemplate(value: unknown): value is WorkspaceTemplate {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.gradeScope === "string"
    && Array.isArray(value.rounds)
    && Array.isArray(value.fields)
    && value.rounds.every((round) => isRecord(round) && typeof round.id === "string" && typeof round.label === "string")
    && value.fields.every(
      (field) => isRecord(field)
        && typeof field.id === "string"
        && typeof field.name === "string"
        && typeof field.dataType === "string"
        && typeof field.isCalculated === "boolean"
        && ["evaluators", "vice-principal", "admin"].includes(String(field.visibility))
    )
    && (value.sections === undefined || (Array.isArray(value.sections) && value.sections.every(
      (section) => isRecord(section)
        && typeof section.id === "string"
        && typeof section.name === "string"
        && isStringArray(section.roundIds)
    )));
}
