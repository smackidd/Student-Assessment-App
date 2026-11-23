"use client";

import { useEffect, useState } from "react";
import { collection, doc, getFirestore, onSnapshot, runTransaction } from "firebase/firestore";
import { firebaseApp } from "@/lib/firebase";
import { organizationId } from "@/lib/organization-auth";
import {
  assertGroupUnchanged, classroomGroupInput, isDefaultClassroomGroup, resolveClassroomGroup, resolveClassroomGroups,
  type ClassroomGroup, type ClassroomGroupInput
} from "@/lib/classroom-groups";

function groupCollection() {
  return collection(getFirestore(firebaseApp), "organizations", organizationId, "classroomGroups");
}

type GroupList = { status: "loading" | "ready" | "error"; groups: ClassroomGroup[] };
const loading: GroupList = { status: "loading", groups: [] };

export function useClassroomGroups(uid: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ uid: string; attempt: number; list: GroupList } | null>(null);
  useEffect(() => {
    if (!uid) {
      setResult(null);
      return;
    }
    const publish = (list: GroupList) => setResult({ uid, attempt, list });
    const failed = () => publish({ status: "error", groups: [] });
    return onSnapshot(groupCollection(), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      try {
        publish({ status: "ready", groups: resolveClassroomGroups(snapshot.docs.map((item) => ({ id: item.id, data: item.data() }))) });
      } catch {
        failed();
      }
    }, failed);
  }, [uid, attempt]);
  const list = result && result.uid === uid && result.attempt === attempt ? result.list : loading;
  return { ...list, retry: () => setAttempt((current) => current + 1) };
}

export type ClassroomGroupList = ReturnType<typeof useClassroomGroups>;

export async function saveClassroomGroup(expected: ClassroomGroup | null, next: ClassroomGroupInput | null) {
  if (!expected && !next) throw new Error("Select a group to delete.");
  const reference = expected ? doc(groupCollection(), expected.id) : doc(groupCollection());
  const value = next && classroomGroupInput(next.name, next.grades);
  await runTransaction(getFirestore(firebaseApp), async (transaction) => {
    const snapshot = await transaction.get(reference);
    assertGroupUnchanged(expected, resolveClassroomGroup(reference.id, snapshot.data()));
    if (value) transaction.set(reference, value);
    else if (isDefaultClassroomGroup(reference.id)) transaction.set(reference, { deleted: true });
    else transaction.delete(reference);
  });
}
