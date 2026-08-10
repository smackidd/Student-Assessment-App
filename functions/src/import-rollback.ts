import {
  parseWorkspaceState,
  WorkspaceScopeError,
  type WorkspacePlacement,
  type WorkspaceRow,
  type WorkspaceState
} from "./workspace-scope.js";

type ImportUpdatedRowSnapshot = {
  studentId: string;
  previousRow: WorkspaceRow;
  nextRow: WorkspaceRow;
};

type ImportChangeLog = {
  id: string;
  fileName: string;
  schoolYear: string;
  grade: string;
  createdAt: string;
  addedStudentIds: string[];
  addedRows: WorkspaceRow[];
  addedPlacements: WorkspacePlacement[];
  updatedRows: ImportUpdatedRowSnapshot[];
  revertedAt?: string;
};

export type ImportRollbackPlan = {
  state: WorkspaceState;
  studentNumbers: string[];
  importLog: ImportChangeLog;
  revertedAt: string;
};

export class ImportRollbackError extends Error {
  constructor(
    readonly code: "failed-precondition" | "invalid-argument" | "not-found",
    message: string
  ) {
    super(message);
    this.name = "ImportRollbackError";
  }
}

export function planImportRollback(
  workspaceValue: unknown,
  importLogId: string,
  revertedAt: string
): ImportRollbackPlan {
  const state = parseWorkspaceState(workspaceValue);
  if (!Array.isArray(state.importLogs)) {
    throw new ImportRollbackError("failed-precondition", "The workspace has no safe import rollback history.");
  }
  const rawImportLog = state.importLogs.find(
    (value) => isRecord(value) && value.id === importLogId
  );
  if (!rawImportLog) throw new ImportRollbackError("not-found", "That import is no longer available to revert.");
  const importLog = parseImportLog(rawImportLog);
  if (importLog.revertedAt) {
    throw new ImportRollbackError("failed-precondition", "This import has already been reverted.");
  }
  if (!validIsoTimestamp(revertedAt)) {
    throw new ImportRollbackError("invalid-argument", "The rollback timestamp is invalid.");
  }

  assertUnchangedImportRows(state.rows, state.placements, importLog);

  const addedStudentIds = new Set(importLog.addedStudentIds);
  const previousRowsById = new Map(
    importLog.updatedRows.map((snapshot) => [snapshot.studentId, snapshot.previousRow])
  );
  const addedPlacementKeys = new Set(importLog.addedPlacements.map(placementKey));
  const nextRows = state.rows
    .filter((row) => !addedStudentIds.has(row.id))
    .map((row) => previousRowsById.get(row.id) ?? row);
  const nextPlacements = state.placements.filter(
    (placement) => !addedPlacementKeys.has(placementKey(placement))
  );
  const nextImportLogs = state.importLogs.map((log) =>
    isRecord(log) && log.id === importLogId ? { ...log, revertedAt } : log
  );

  return {
    state: {
      ...state,
      rows: nextRows,
      placements: nextPlacements,
      importLogs: nextImportLogs,
      pendingStudentSync: false
    },
    studentNumbers: [...addedStudentIds],
    importLog,
    revertedAt
  };
}

function assertUnchangedImportRows(
  rows: WorkspaceRow[],
  placements: WorkspacePlacement[],
  importLog: ImportChangeLog
) {
  const currentRowsById = new Map(rows.map((row) => [row.id, row]));
  const addedRowsById = new Map(importLog.addedRows.map((row) => [row.id, row]));
  const addedStudentIds = new Set(importLog.addedStudentIds);
  const updatedStudentIds = new Set(importLog.updatedRows.map((snapshot) => snapshot.studentId));

  if (
    addedRowsById.size !== addedStudentIds.size
    || [...addedStudentIds].some((studentId) => !addedRowsById.has(studentId))
  ) {
    throw new ImportRollbackError(
      "failed-precondition",
      "This import predates safe SQL rollback tracking. No data was changed."
    );
  }
  if ([...addedStudentIds].some((studentId) => updatedStudentIds.has(studentId))) {
    throw new ImportRollbackError("failed-precondition", "The import rollback record is inconsistent. No data was changed.");
  }

  const changedExistingRows = importLog.updatedRows.filter(
    (snapshot) => !sameRecord(currentRowsById.get(snapshot.studentId), snapshot.nextRow)
  );
  const changedAddedRows = importLog.addedRows.filter(
    (snapshot) => !sameRecord(currentRowsById.get(snapshot.id), snapshot)
  );
  if (changedExistingRows.length || changedAddedRows.length) {
    const count = changedExistingRows.length + changedAddedRows.length;
    throw new ImportRollbackError(
      "failed-precondition",
      `This import cannot be reverted because ${count} affected student record${count === 1 ? " has" : "s have"} changed since the import. No data was changed.`
    );
  }

  const expectedAddedPlacementKeys = new Set(importLog.addedPlacements.map(placementKey));
  const currentPlacementKeys = new Set(placements.map(placementKey));
  const addedStudentPlacementKeys = new Set(
    placements.filter((placement) => addedStudentIds.has(placement.studentId)).map(placementKey)
  );
  const placementChanged =
    [...expectedAddedPlacementKeys].some((key) => !currentPlacementKeys.has(key))
    || [...addedStudentPlacementKeys].some((key) => !expectedAddedPlacementKeys.has(key));
  if (placementChanged) {
    throw new ImportRollbackError(
      "failed-precondition",
      "This import cannot be reverted because an imported student placement changed after the import. No data was changed."
    );
  }
}

function parseImportLog(value: unknown): ImportChangeLog {
  if (!isRecord(value)) throw invalidImportLog();
  const addedStudentIds = stringArray(value.addedStudentIds);
  const addedRows = Array.isArray(value.addedRows) && value.addedRows.every(isWorkspaceRow)
    ? value.addedRows
    : null;
  const addedPlacements = Array.isArray(value.addedPlacements) && value.addedPlacements.every(isWorkspacePlacement)
    ? value.addedPlacements
    : null;
  const updatedRows = Array.isArray(value.updatedRows)
    ? value.updatedRows.map(parseUpdatedRowSnapshot)
    : null;
  if (
    typeof value.id !== "string"
    || typeof value.fileName !== "string"
    || typeof value.schoolYear !== "string"
    || typeof value.grade !== "string"
    || typeof value.createdAt !== "string"
    || !addedStudentIds
    || !addedRows
    || !addedPlacements
    || !updatedRows
    || (value.revertedAt !== undefined && typeof value.revertedAt !== "string")
  ) {
    throw invalidImportLog();
  }
  return {
    id: value.id,
    fileName: value.fileName,
    schoolYear: value.schoolYear,
    grade: value.grade,
    createdAt: value.createdAt,
    addedStudentIds: uniqueStrings(addedStudentIds),
    addedRows,
    addedPlacements,
    updatedRows,
    ...(value.revertedAt ? { revertedAt: value.revertedAt } : {})
  };
}

function parseUpdatedRowSnapshot(value: unknown): ImportUpdatedRowSnapshot {
  if (
    !isRecord(value)
    || typeof value.studentId !== "string"
    || !isWorkspaceRow(value.previousRow)
    || !isWorkspaceRow(value.nextRow)
  ) {
    throw invalidImportLog();
  }
  return {
    studentId: value.studentId,
    previousRow: value.previousRow,
    nextRow: value.nextRow
  };
}

function invalidImportLog() {
  return new ImportRollbackError("failed-precondition", "The import rollback record is incomplete. No data was changed.");
}

function placementKey(placement: WorkspacePlacement) {
  return [placement.studentId, placement.schoolYear, placement.grade, placement.homeroom].join("\u001f");
}

function sameRecord(current: WorkspaceRow | undefined, expected: WorkspaceRow) {
  return current !== undefined && isDeepStrictEqual(current, expected);
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function validIsoTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkspaceRow(value: unknown): value is WorkspaceRow {
  try {
    parseWorkspaceState({ rows: [value], placements: [], templates: [], schoolYears: [] });
    return true;
  } catch (error) {
    if (error instanceof WorkspaceScopeError) return false;
    throw error;
  }
}

function isWorkspacePlacement(value: unknown): value is WorkspacePlacement {
  try {
    parseWorkspaceState({ rows: [], placements: [value], templates: [], schoolYears: [] });
    return true;
  } catch (error) {
    if (error instanceof WorkspaceScopeError) return false;
    throw error;
  }
}
import { isDeepStrictEqual } from "node:util";
