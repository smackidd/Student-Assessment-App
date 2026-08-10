import type { OrganizationAuditEvent } from "@/lib/audit-events";

type AuditOutboxStorage = Pick<Storage, "getItem" | "setItem">;

const auditOutboxPrefix = "student-assessment:audit-outbox:v1:";

export function auditOutboxStorageKey(uid: string) {
  return `${auditOutboxPrefix}${uid}`;
}

export function readAuditOutbox(uid: string, storage?: AuditOutboxStorage) {
  const availableStorage = storage ?? browserStorage();
  if (!uid || !availableStorage) return [];

  try {
    const value = availableStorage.getItem(auditOutboxStorageKey(uid));
    if (!value) return [];
    const events = JSON.parse(value);
    if (!Array.isArray(events)) return [];
    return events.filter((event): event is OrganizationAuditEvent => validPendingAuditEvent(event, uid));
  } catch {
    return [];
  }
}

export function queueAuditEvent(
  uid: string,
  event: OrganizationAuditEvent,
  storage?: AuditOutboxStorage
) {
  const current = readAuditOutbox(uid, storage);
  return writeAuditOutbox(uid, [event, ...current.filter((item) => item.id !== event.id)], storage);
}

export function removeAuditEventFromOutbox(
  uid: string,
  eventId: string,
  storage?: AuditOutboxStorage
) {
  const current = readAuditOutbox(uid, storage);
  return writeAuditOutbox(uid, current.filter((event) => event.id !== eventId), storage);
}

export function reconcileAuditOutbox(
  uid: string,
  savedEventIds: ReadonlySet<string>,
  storage?: AuditOutboxStorage
) {
  const current = readAuditOutbox(uid, storage);
  const pending = current.filter((event) => !savedEventIds.has(event.id));
  writeAuditOutbox(uid, pending, storage);
  return pending;
}

function writeAuditOutbox(
  uid: string,
  events: OrganizationAuditEvent[],
  storage?: AuditOutboxStorage
) {
  const availableStorage = storage ?? browserStorage();
  if (!uid || !availableStorage) return events;
  try {
    availableStorage.setItem(auditOutboxStorageKey(uid), JSON.stringify(events));
  } catch {
    // The in-memory event remains visible even when browser storage is unavailable.
  }
  return events;
}

function validPendingAuditEvent(value: unknown, uid: string): value is OrganizationAuditEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<OrganizationAuditEvent>;
  return Boolean(
    text(event.id)
      && text(event.eventType)
      && text(event.entityType)
      && text(event.entityLabel)
      && text(event.description)
      && text(event.createdAt)
      && text(event.actor)
      && (!event.actorUid || event.actorUid === uid)
  );
}

function text(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function browserStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}
