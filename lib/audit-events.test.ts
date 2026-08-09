import { describe, expect, it } from "vitest";
import { mergeAuditEvents, sortAuditEvents, type OrganizationAuditEvent } from "@/lib/audit-events";

function auditEvent(id: string, actor: string, createdAt: string, extra: Partial<OrganizationAuditEvent> = {}): OrganizationAuditEvent {
  return {
    id,
    actor,
    createdAt,
    eventType: "Edited score",
    entityType: "Assessment result",
    entityLabel: id,
    description: `Changed ${id}`,
    ...extra
  };
}

describe("audit events", () => {
  it("merges legacy and cloud events without duplicates and prefers the latest source", () => {
    const legacy = auditEvent("same", "VP workspace", "2026-08-09T12:00:00.000Z");
    const cloud = auditEvent("same", "Steve", "2026-08-09T12:00:01.000Z", { actorUid: "steve" });
    const other = auditEvent("other", "Kathleen", "2026-08-09T13:00:00.000Z");

    expect(mergeAuditEvents([legacy], [cloud, other])).toEqual([other, cloud]);
  });

  it("derives reverted state from the append-only revert event", () => {
    const imported = auditEvent("import", "Steve", "2026-08-09T12:00:00.000Z", {
      eventType: "Imported spreadsheet",
      importLogId: "import-1"
    });
    const reverted = auditEvent("revert", "Steve", "2026-08-09T13:00:00.000Z", {
      eventType: "Reverted import",
      importLogId: "import-1"
    });

    const result = mergeAuditEvents([imported, reverted]);
    expect(result.find((event) => event.id === "import")?.revertedAt).toBe(reverted.createdAt);
  });

  it("sorts by Actor without losing rows and preserves tie order", () => {
    const events = [
      auditEvent("first-steve", "Steve", "2026-08-09T12:00:00.000Z"),
      auditEvent("kathleen", "Kathleen", "2026-08-09T13:00:00.000Z"),
      auditEvent("second-steve", "Steve", "2026-08-09T14:00:00.000Z")
    ];

    expect(sortAuditEvents(events, "actor").map((event) => event.id)).toEqual([
      "first-steve",
      "second-steve",
      "kathleen"
    ]);
    expect(events.map((event) => event.id)).toEqual(["first-steve", "kathleen", "second-steve"]);
  });
});
