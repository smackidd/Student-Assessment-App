import { executeQuery, getDataConnect, queryRef } from "firebase/data-connect";
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { dataConnectConfig, firebaseApp } from "@/lib/firebase";
import type { AssessmentTemplate } from "@/lib/assessment-templates";
import type { OrganizationAuditEvent } from "@/lib/audit-events";
import { hydrateOrfRow, type OrfResultRow } from "@/lib/sample-results";
import {
  displayNameFor,
  type PersistedStudent
} from "@/lib/student-save-planner";

type SavedStudent = PersistedStudent;

type ListStudentsResult = {
  students: SavedStudent[];
};

type PrototypeWorkspaceState = {
  rows: OrfResultRow[];
  placements: Array<{
    studentId: string;
    schoolYear: string;
    grade: string;
    homeroom: string;
  }>;
  templates: AssessmentTemplate[];
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
  teamMembers?: Array<{
    id: string;
    name: string;
    email: string;
    role: "Admin" | "Teacher / EA";
    status: "invited" | "active";
  }>;
  auditEvents?: OrganizationAuditEvent[];
  importLogs?: Array<{
    id: string;
    fileName: string;
    schoolYear: string;
    grade: string;
    createdAt: string;
    importedCount: number;
    dataCellCount: number;
    duplicateNames: string[];
    addedStudentIds: string[];
    addedRows?: OrfResultRow[];
    addedPlacements: Array<{
      studentId: string;
      schoolYear: string;
      grade: string;
      homeroom: string;
    }>;
    updatedRows: Array<{
      studentId: string;
      previousRow: OrfResultRow;
      nextRow: OrfResultRow;
    }>;
    revertedAt?: string;
  }>;
};

type LoadAuthorizedWorkspaceStateResult = {
  state: PrototypeWorkspaceState | null;
  version: string | null;
};

type SaveAuthorizedWorkspaceStateResult = {
  state: PrototypeWorkspaceState;
  version: string;
};

type RevertSpreadsheetImportResult = {
  state: PrototypeWorkspaceState;
  version: string;
  importLogId: string;
  deletedStudentCount: number;
  auditSaved: boolean;
  event?: OrganizationAuditEvent;
};

const dataConnect = getDataConnect(firebaseApp, dataConnectConfig);
let loadedWorkspaceVersion: string | null | undefined;

export async function loadPrototypeWorkspaceState(id = "main") {
  await ensureFirebaseUser();
  assertMainWorkspace(id);
  const loadWorkspace = httpsCallable<Record<string, never>, LoadAuthorizedWorkspaceStateResult>(
    workspaceFunctions(),
    "loadAuthorizedWorkspaceState"
  );
  const result = await loadWorkspace({});
  loadedWorkspaceVersion = result.data.version;
  return result.data.state;
}

export async function savePrototypeWorkspaceState(state: PrototypeWorkspaceState, id = "main") {
  await ensureFirebaseUser();
  assertMainWorkspace(id);
  if (typeof loadedWorkspaceVersion === "undefined") {
    throw new Error("Reload the workspace before saving changes.");
  }
  const saveWorkspace = httpsCallable<
    { state: PrototypeWorkspaceState; version: string | null },
    SaveAuthorizedWorkspaceStateResult
  >(
    workspaceFunctions(),
    "saveAuthorizedWorkspaceState"
  );
  const result = await saveWorkspace({ state, version: loadedWorkspaceVersion });
  loadedWorkspaceVersion = result.data.version;
  return result.data.state;
}

export async function revertSpreadsheetImport(importLogId: string) {
  await ensureFirebaseUser();
  const revertImport = httpsCallable<{ importLogId: string }, RevertSpreadsheetImportResult>(
    workspaceFunctions(),
    "revertSpreadsheetImport"
  );
  const result = await revertImport({ importLogId });
  loadedWorkspaceVersion = result.data.version;
  return result.data;
}

export async function loadStudentsFromDatabase() {
  await ensureFirebaseUser();
  const result = await executeQuery<ListStudentsResult, undefined>(queryRef(dataConnect, "ListStudents"), {
    fetchPolicy: "SERVER_ONLY"
  });
  return result.data.students.map((student) =>
    hydrateOrfRow({
      id: student.studentNumber || student.id,
      student: displayNameFor(student),
      homeroom: "Saved",
      septP1Wpm: null,
      septP1Epm: null,
      septP2Wpm: null,
      septP2Epm: null,
      septP3Wpm: null,
      septP3Epm: null
    })
  );
}

export async function saveStudentsToDatabase(rows: OrfResultRow[]) {
  await ensureFirebaseUser();
  const syncStudents = httpsCallable<
    { students: Array<{ id: string; student: string }> },
    { createdCount: number; updatedCount: number; skippedCount: number; batchCount: number; durationMs: number }
  >(workspaceFunctions(), "syncOrganizationStudents");
  const result = await syncStudents({ students: rows.map(({ id, student }) => ({ id, student })) });
  return result.data;
}

async function ensureFirebaseUser() {
  const auth = getAuth(firebaseApp);
  if (auth.currentUser) return auth.currentUser;

  throw new Error("Please sign in before saving or loading Firebase data.");
}

function workspaceFunctions() {
  return getFunctions(
    firebaseApp,
    process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION ?? "northamerica-northeast1"
  );
}

function assertMainWorkspace(id: string) {
  if (id !== "main") throw new Error("Only the authorized main workspace is available.");
}
