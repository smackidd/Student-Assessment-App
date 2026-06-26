import { executeMutation, executeQuery, getDataConnect, mutationRef, queryRef } from "firebase/data-connect";
import { getAuth } from "firebase/auth";
import { dataConnectConfig, firebaseApp } from "@/lib/firebase";
import type { AssessmentTemplate } from "@/lib/assessment-templates";
import { hydrateOrfRow, type OrfResultRow } from "@/lib/sample-results";

type SavedStudent = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  studentNumber?: string | null;
  active: boolean;
};

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
  currentUserRole?: "Principal" | "Vice Principal" | "Evaluator";
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
    role: "Principal" | "Vice Principal" | "Evaluator";
    grade: string;
    homeroom: string;
    status: "invited" | "active";
  }>;
  auditEvents?: Array<{
    id: string;
    eventType: string;
    entityType: string;
    entityLabel: string;
    description: string;
    createdAt: string;
    actor: string;
    importLogId?: string;
    revertedAt?: string;
  }>;
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
  await ensureFirebaseUser();
  const existing = await executeQuery<ListStudentsResult, undefined>(queryRef(dataConnect, "ListStudents"), {
    fetchPolicy: "SERVER_ONLY"
  });
  const savedStudentsByNumber = new Map(
    existing.data.students
      .filter((student) => student.studentNumber)
      .map((student) => [student.studentNumber as string, student])
  );
  let createdCount = 0;
  let updatedCount = 0;

  for (const row of rows) {
    const savedStudent = savedStudentsByNumber.get(row.id);
    const nameParts = namePartsFor(row.student);

    if (savedStudent) {
      await executeMutation<UpdateStudentNameResult, UpdateStudentVariables>(
        mutationRef(dataConnect, "UpdateStudentName", {
          studentId: savedStudent.id,
          ...nameParts,
          preferredName: null
        })
      );
      updatedCount += 1;
      continue;
    }

    await executeMutation<CreateStudentResult, StudentVariables>(
      mutationRef(dataConnect, "CreateStudent", {
        ...nameParts,
        preferredName: null,
        studentNumber: row.id
      })
    );
    savedStudentsByNumber.set(row.id, {
      id: row.id,
      ...nameParts,
      preferredName: null,
      studentNumber: row.id,
      active: true
    });
    createdCount += 1;
  }

  return {
    createdCount,
    updatedCount
  };
}

async function ensureFirebaseUser() {
  const auth = getAuth(firebaseApp);
  if (auth.currentUser) return auth.currentUser;

  throw new Error("Please sign in before saving or loading Firebase data.");
}

function displayNameFor(student: SavedStudent) {
  return student.preferredName || [student.firstName, student.lastName].filter(Boolean).join(" ").trim() || "Saved Student";
}

function namePartsFor(displayName: string): StudentVariables {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "New", lastName: "Student" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "Student" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1]
  };
}

type StudentVariables = {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  studentNumber?: string | null;
};

type UpdateStudentVariables = {
  studentId: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
};
