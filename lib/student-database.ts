import { executeMutation, executeQuery, getDataConnect, mutationRef, queryRef } from "firebase/data-connect";
import { getAuth } from "firebase/auth";
import { dataConnectConfig, firebaseApp } from "@/lib/firebase";
import type { AssessmentTemplate } from "@/lib/assessment-templates";
import type { OrganizationAuditEvent } from "@/lib/audit-events";
import { hydrateOrfRow, type OrfResultRow } from "@/lib/sample-results";
import {
  buildStudentSavePlan,
  displayNameFor,
  runInBatches,
  type PersistedStudent,
  type StudentSaveAction
} from "@/lib/student-save-planner";

type SavedStudent = PersistedStudent;

type ListStudentsResult = {
  students: SavedStudent[];
};

type CreateStudentResult = {
  student_insert: SavedStudent;
};

type UpdateStudentNameResult = {
  student_update: SavedStudent;
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

type GetPrototypeWorkspaceStateResult = {
  prototypeWorkspaceState?: {
    id: string;
    stateJson: PrototypeWorkspaceState;
    updatedAt: string;
  } | null;
};

type SavePrototypeWorkspaceStateResult = {
  prototypeWorkspaceState_upsert: {
    id: string;
    stateJson: PrototypeWorkspaceState;
    updatedAt: string;
  };
};

const dataConnect = getDataConnect(firebaseApp, dataConnectConfig);
const STUDENT_WRITE_BATCH_SIZE = 8;

export async function loadPrototypeWorkspaceState(id = "main") {
  await ensureFirebaseUser();
  const result = await executeQuery<GetPrototypeWorkspaceStateResult, { id: string }>(
    queryRef(dataConnect, "GetPrototypeWorkspaceState", { id }),
    { fetchPolicy: "SERVER_ONLY" }
  );
  return result.data.prototypeWorkspaceState?.stateJson ?? null;
}

export async function savePrototypeWorkspaceState(state: PrototypeWorkspaceState, id = "main") {
  await ensureFirebaseUser();
  await executeMutation<SavePrototypeWorkspaceStateResult, { id: string; stateJson: PrototypeWorkspaceState }>(
    mutationRef(dataConnect, "SavePrototypeWorkspaceState", { id, stateJson: state })
  );
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
  const startedAt = Date.now();
  await ensureFirebaseUser();
  const existing = await executeQuery<ListStudentsResult, undefined>(queryRef(dataConnect, "ListStudents"), {
    fetchPolicy: "SERVER_ONLY"
  });
  const plan = buildStudentSavePlan(rows, existing.data.students);
  const results = await runInBatches(plan.actions, STUDENT_WRITE_BATCH_SIZE, executeStudentSaveAction);
  const createdCount = results.filter((result) => result === "created").length;
  const updatedCount = results.filter((result) => result === "updated").length;

  return {
    createdCount,
    updatedCount,
    skippedCount: plan.skippedCount,
    batchCount: Math.ceil(plan.actions.length / STUDENT_WRITE_BATCH_SIZE),
    durationMs: Date.now() - startedAt
  };
}

async function executeStudentSaveAction(action: StudentSaveAction): Promise<"created" | "updated"> {
  if (action.kind === "update") {
    await executeMutation<UpdateStudentNameResult, typeof action.variables>(
      mutationRef(dataConnect, "UpdateStudentName", action.variables)
    );
    return "updated";
  }

  try {
    await executeMutation<CreateStudentResult, typeof action.variables>(
      mutationRef(dataConnect, "CreateStudent", action.variables)
    );
    return "created";
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;

    const refreshed = await executeQuery<ListStudentsResult, undefined>(queryRef(dataConnect, "ListStudents"), {
      fetchPolicy: "SERVER_ONLY"
    });
    const savedStudent = refreshed.data.students.find((student) => student.studentNumber === action.studentNumber);
    if (!savedStudent) throw error;

    await executeMutation<UpdateStudentNameResult, UpdateStudentVariables>(
      mutationRef(dataConnect, "UpdateStudentName", {
        studentId: savedStudent.id,
        firstName: action.variables.firstName,
        lastName: action.variables.lastName,
        preferredName: action.variables.preferredName
      })
    );
    return "updated";
  }
}

function isAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("student_studentNumber_uidx") || message.includes("ALREADY_EXISTS");
}

async function ensureFirebaseUser() {
  const auth = getAuth(firebaseApp);
  if (auth.currentUser) return auth.currentUser;

  throw new Error("Please sign in before saving or loading Firebase data.");
}

type UpdateStudentVariables = {
  studentId: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
};
