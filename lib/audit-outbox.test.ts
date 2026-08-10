import { describe, expect, it } from "vitest";
import {
  auditOutboxStorageKey,
  queueAuditEvent,
  readAuditOutbox,
  reconcileAuditOutbox,
  removeAuditEventFromOutbox
} from "@/lib/audit-outbox";
import type { OrganizationAuditEvent } from "@/lib/audit-events";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value)
  };
}

function event(id: string, uid = "admin-a"): OrganizationAuditEvent {
  return {
    id,
    eventType: "Edited score",
    entityType: "Assessment result",
    entityLabel: "Student A / WPM",
    description: "Changed WPM from 20 to 21.",
    createdAt: "2026-08-10T20:00:00.000Z",
    actor: "Admin A",
    actorUid: uid
  };
}

describe("audit outbox", () => {
  it("keeps pending audit events isolated by authenticated UID", () => {
    const storage = memoryStorage();
    queueAuditEvent("admin-a", event("event-a"), storage);

    expect(readAuditOutbox("admin-a", storage)).toEqual([event("event-a")]);
    expect(readAuditOutbox("admin-b", storage)).toEqual([]);
    expect(auditOutboxStorageKey("admin-a")).not.toBe(auditOutboxStorageKey("admin-b"));
  });

  it("deduplicates retries and removes events after a successful write", () => {
    const storage = memoryStorage();
    queueAuditEvent("admin-a", event("event-a"), storage);
    queueAuditEvent("admin-a", { ...event("event-a"), description: "Latest description" }, storage);

    expect(readAuditOutbox("admin-a", storage)).toHaveLength(1);
    removeAuditEventFromOutbox("admin-a", "event-a", storage);
    expect(readAuditOutbox("admin-a", storage)).toEqual([]);
  });

  it("reconciles events already observed in the shared audit stream", () => {
    const storage = memoryStorage();
    queueAuditEvent("admin-a", event("event-a"), storage);
    queueAuditEvent("admin-a", event("event-b"), storage);

    expect(reconcileAuditOutbox("admin-a", new Set(["event-a"]), storage)).toEqual([event("event-b")]);
  });

  it("discards malformed or cross-account stored events", () => {
    const storage = memoryStorage();
    storage.setItem(auditOutboxStorageKey("admin-a"), JSON.stringify([
      event("event-a", "admin-b"),
      { id: "incomplete" }
    ]));

    expect(readAuditOutbox("admin-a", storage)).toEqual([]);
  });
});
