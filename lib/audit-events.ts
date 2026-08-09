export type OrganizationAuditEvent = {
  id: string;
  eventType: string;
  entityType: string;
  entityLabel: string;
  description: string;
  createdAt: string;
  actor: string;
  actorUid?: string;
  actorEmail?: string;
  importLogId?: string;
  revertedAt?: string;
};

export type AuditSortKey = "createdAt" | "eventType" | "entityType" | "entityLabel" | "actor";

export function mergeAuditEvents(...eventGroups: Array<readonly OrganizationAuditEvent[] | null | undefined>) {
  const eventsById = new Map<string, OrganizationAuditEvent>();

  for (const events of eventGroups) {
    for (const event of events ?? []) {
      if (!event?.id) continue;
      eventsById.set(event.id, event);
    }
  }

  const merged = Array.from(eventsById.values()).sort(compareAuditDatesDescending);
  const revertedAtByImportId = new Map<string, string>();

  for (const event of merged) {
    if (event.eventType !== "Reverted import" || !event.importLogId) continue;
    if (!revertedAtByImportId.has(event.importLogId)) {
      revertedAtByImportId.set(event.importLogId, event.createdAt);
    }
  }

  return merged.map((event) => {
    if (event.eventType !== "Imported spreadsheet" || !event.importLogId || event.revertedAt) return event;
    const revertedAt = revertedAtByImportId.get(event.importLogId);
    return revertedAt ? { ...event, revertedAt } : event;
  });
}

export function sortAuditEvents(events: readonly OrganizationAuditEvent[], sortKey: AuditSortKey) {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const comparison = auditSortValue(right.event, sortKey).localeCompare(
        auditSortValue(left.event, sortKey),
        undefined,
        { numeric: true, sensitivity: "base" }
      );
      return comparison || left.index - right.index;
    })
    .map(({ event }) => event);
}

function auditSortValue(event: OrganizationAuditEvent, sortKey: AuditSortKey) {
  if (sortKey === "createdAt") {
    const timestamp = Date.parse(event.createdAt);
    return Number.isFinite(timestamp) ? String(timestamp).padStart(16, "0") : "0";
  }
  return event[sortKey] ?? "";
}

function compareAuditDatesDescending(left: OrganizationAuditEvent, right: OrganizationAuditEvent) {
  const timestampDifference = auditTimestamp(right.createdAt) - auditTimestamp(left.createdAt);
  return timestampDifference || right.id.localeCompare(left.id);
}

function auditTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
