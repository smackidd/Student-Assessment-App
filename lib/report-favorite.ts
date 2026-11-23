export type ReportFavorite = {
  studentIds: string[];
  assessmentIds: string[];
  years: string[];
};

// Only restore explicitly selected, currently accessible IDs. Never substitute a different student.
export function decodeReportFavorite(value: unknown, available: ReportFavorite): ReportFavorite | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  function ids(key: keyof ReportFavorite) {
    const saved = raw[key];
    if (!Array.isArray(saved) || !saved.every((id): id is string => typeof id === "string")) return null;
    const allowed = new Set(available[key]);
    const valid = [...new Set(saved)].filter((id) => allowed.has(id));
    return saved.length && !valid.length ? null : valid;
  }
  const studentIds = ids("studentIds"), assessmentIds = ids("assessmentIds"), years = ids("years");
  if (!studentIds || !assessmentIds || !years) return null;
  return { studentIds, assessmentIds, years };
}
