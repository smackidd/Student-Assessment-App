import { collection, getFirestore, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { firebaseApp } from "@/lib/firebase";
import { organizationId } from "@/lib/organization-auth";
import type { OrganizationAuditEvent } from "@/lib/audit-events";

export type RecordOrganizationAuditEventInput = Pick<
  OrganizationAuditEvent,
  "id" | "eventType" | "entityType" | "entityLabel" | "description" | "importLogId"
>;

type RecordOrganizationAuditEventResult = {
  event: OrganizationAuditEvent;
};

function organizationFunctions() {
  return getFunctions(
    firebaseApp,
    process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION ?? "northamerica-northeast1"
  );
}

export async function recordOrganizationAuditEvent(input: RecordOrganizationAuditEventInput) {
  const recordAuditEvent = httpsCallable<
    RecordOrganizationAuditEventInput,
    RecordOrganizationAuditEventResult
  >(organizationFunctions(), "recordAuditEvent");
  const result = await recordAuditEvent(input);
  return result.data.event;
}

export function watchOrganizationAuditEvents(
  onEvents: (events: OrganizationAuditEvent[]) => void,
  onError?: (error: Error) => void
) {
  const auditEvents = query(
    collection(getFirestore(firebaseApp), "organizations", organizationId, "auditEvents"),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(
    auditEvents,
    (snapshot) => {
      onEvents(
        snapshot.docs
          .map((snapshotDocument) => auditEventFromFirestore(snapshotDocument.id, snapshotDocument.data()))
          .filter((event): event is OrganizationAuditEvent => event !== null)
      );
    },
    (error) => onError?.(error)
  );
}

function auditEventFromFirestore(id: string, value: Record<string, unknown>): OrganizationAuditEvent | null {
  const eventType = text(value.eventType);
  const entityType = text(value.entityType);
  const entityLabel = text(value.entityLabel);
  const description = text(value.description);
  const actor = text(value.actor);
  const createdAt = timestampIso(value.createdAt);
  if (!eventType || !entityType || !entityLabel || !description || !actor || !createdAt) return null;

  const actorUid = text(value.actorUid);
  const actorEmail = text(value.actorEmail);
  const importLogId = text(value.importLogId);
  return {
    id,
    eventType,
    entityType,
    entityLabel,
    description,
    actor,
    createdAt,
    ...(actorUid ? { actorUid } : {}),
    ...(actorEmail ? { actorEmail } : {}),
    ...(importLogId ? { importLogId } : {})
  };
}

function timestampIso(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }
  if (typeof value !== "string") return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
