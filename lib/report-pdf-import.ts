import type { AssessmentFieldTemplate, AssessmentRoundTemplate, AssessmentSectionTemplate, AssessmentTemplate } from "./assessment-templates";
import { assessmentFieldAppliesToGrade, assessmentValueKey, entryValue, sectionsForAssessmentRound, validateAssessmentValue } from "./assessment-entry";
import type { StudentPlacement } from "./overview-state";
import type { OrfResultRow, AssessmentValue } from "./sample-results";
import type { PdfTextPage } from "./pdf-text";

export type StarReportKind = "Star Math" | "Star Reading";
export type StarReportMetric = "scaledScore" | "projectedScore" | "percentileRank" | "instructionalReadingLevel" | "zoneOfProximalDevelopment";
export type ParsedStarReportStudent = {
  assessmentKind: StarReportKind | null;
  pageNumber: number;
  studentName: string;
  grade: string;
  testDate: string;
  schoolYear: string;
  season: string;
  values: Partial<Record<StarReportMetric, number | string>>;
  issues: string[];
};
export type ReportPdfDocument = {
  id: string;
  fileName: string;
  students: ParsedStarReportStudent[];
  issues: string[];
};
export type ReportImportSelection = { schoolYear: string; grade: string; assessmentId: string; roundId: string };
export type ReportImportColumn = { key: string; field: AssessmentFieldTemplate; section?: AssessmentSectionTemplate; metric: StarReportMetric | null };
export type ReportImportReviewRow = {
  id: string;
  documentId: string;
  fileName: string;
  pageNumber: number;
  sourceName: string;
  studentId?: string;
  studentName: string;
  homeroom: string;
  testDate: string;
  values: Record<string, AssessmentValue>;
  previousValues: Record<string, AssessmentValue>;
  issues: string[];
};
export type ReportImportWorkspace = { rows: OrfResultRow[]; placements: StudentPlacement[]; templates: AssessmentTemplate[]; schoolYears: string[]; lockedOverviewYears?: string[] };
export type ReportImportRequest = { selection: ReportImportSelection; documents: ReportPdfDocument[]; selectedRowIds: string[] };

const labelKey = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9%]/g, "");

export function isStarMathAssessment(assessment: AssessmentTemplate) {
  return starAssessmentKind(assessment) === "Star Math";
}

export function starAssessmentKind(assessment: AssessmentTemplate): StarReportKind | null {
  for (const name of [assessment.name, assessment.id]) {
    if (/^(?:renaissance)?starmath(?:enterprise)?$/.test(labelKey(name))) return "Star Math";
    if (/^(?:renaissance)?starread(?:ing)?(?:enterprise)?$/.test(labelKey(name))) return "Star Reading";
  }
  return null;
}

export function reportAssessmentForYear(template: AssessmentTemplate, year: string): AssessmentTemplate {
  return { ...template, ...(template.yearDefinitions?.[year] ?? {}) };
}

export function reportStudentNameKey(value: string) {
  const clean = value.replace(/\([^)]*\)/g, " ").replace(/\s*[-–]\s*(?:she\/her|he\/him|they\/them).*$/i, "").trim();
  const parts = clean.split(",");
  return labelKey(parts.length === 2 ? `${parts[1]} ${parts[0]}` : clean);
}

function metricForField(field: AssessmentFieldTemplate, kind: StarReportKind | null): StarReportMetric | null {
  for (const name of [field.name, field.slug].map(labelKey)) {
    if (["pr", "percentilerank", "prpercentilerank", "percentile", "%ile", "ile", "percentileranking"].includes(name)) return "percentileRank";
    if (["projectedss", "projectedscaledscore", "projectedscore"].includes(name)) return "projectedScore";
    if (["ss", "scaledscore", "ssscaledscore", "starscaledscore"].includes(name)) return "scaledScore";
    if (kind === "Star Reading") {
      if (["irl", "instructionalreadinglevel", "irlinstructionalreadinglevel"].includes(name)) return "instructionalReadingLevel";
      if (["zpd", "zoneofproximaldevelopment", "zpdzoneofproximaldevelopment"].includes(name)) return "zoneOfProximalDevelopment";
    }
  }
  return null;
}

function parseTestDate(value: string) {
  const match = value.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (!match) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  const startYear = month >= 8 ? year : year - 1;
  return { testDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, schoolYear: `${startYear}-${startYear + 1}`, season: month >= 8 ? "fall" : month <= 3 ? "winter" : "spring" };
}

function roundSeason(round: AssessmentRoundTemplate) {
  const value = `${round.label} ${round.month} ${round.id}`.toLowerCase();
  if (/\b(fall|autumn)\b/.test(value)) return "fall";
  if (/\bwinter\b/.test(value)) return "winter";
  if (/\bspring\b/.test(value)) return "spring";
  if (/\b(aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\b/.test(value)) return "fall";
  if (/\b(jan\w*|feb\w*|mar\w*)\b/.test(value)) return "winter";
  if (/\b(apr\w*|may|jun\w*|jul\w*)\b/.test(value)) return "spring";
  return null;
}

// Parse the labeled results cards, not numbers from the benchmark graph or
// instructional skills pages. A single class PDF can contain many students.
export function parseStarReportPdf(pages: PdfTextPage[], fileName: string, id: string): ReportPdfDocument {
  const students: ParsedStarReportStudent[] = [];
  const issues: string[] = [];
  for (const page of pages) {
    const text = page.text.replace(/\s+/g, " ").trim();
    const name = /\bStudent\s+(?!Report\b)((?:(?!\bStudent\b).)+?)\s+Test Date\b/i.exec(text);
    if (!name) {
      if (/Instructional Planning\s*[–-]\s*Student Report/i.test(text)) issues.push(`Page ${page.pageNumber}: the student name could not be read.`);
      continue;
    }
    const studentIssues: string[] = [];
    const heading = /Instructional Planning\s*[–-]\s*Student Report\s+Star (Math|Reading|Early Literacy)(?: Enterprise)?\b/i.exec(text);
    const dateBlock = /\bTest Date\s+(.+?)\s+Grade\s+(\d{1,2})\s+(?:Teacher|Class\/Group)\b/i.exec(text);
    const date = dateBlock ? parseTestDate(dateBlock[1]) : null;
    if (!date) studentIssues.push("The test date could not be verified.");
    if (!dateBlock) studentIssues.push("The student's grade could not be verified.");
    const resultBlocks = [...text.matchAll(/Star (Math|Reading)(?: Enterprise)? Tests? Results?\s+(.+?)(?=Suggested Skills|Star (?:Math|Reading)(?: Enterprise)? Tests? Results?|$)/gi)];
    const resultBlock = resultBlocks.length === 1 ? resultBlocks[0] : undefined;
    const resultKind = resultBlock ? (resultBlock[1].toLowerCase() === "math" ? "Star Math" : "Star Reading") : null;
    // Class exports print the document title once; later students still have
    // their own assessment-specific results heading on the score page.
    const assessmentKind: StarReportKind | null = heading
      ? heading[1].toLowerCase() === "math" ? "Star Math" : heading[1].toLowerCase() === "reading" ? "Star Reading" : null
      : resultKind;
    if (!assessmentKind) studentIssues.push("The report is not a supported Star Math or Star Reading assessment.");
    if (assessmentKind && resultKind !== assessmentKind) studentIssues.push("The score heading is missing, ambiguous, or does not match the report assessment.");
    const results = resultBlock?.[2] ?? "";
    const values: ParsedStarReportStudent["values"] = {};
    const patterns: Array<[StarReportMetric, RegExp]> = [
      ["scaledScore", /(?:^|\s)SS\s*\(Scaled Score\)\s*(\d+(?:\.\d+)?)(?=\s|$)/i],
      ["projectedScore", /Projected SS\s*\(for [^)]+\)\s*(\d+(?:\.\d+)?)(?=\s|$)/i],
      ["percentileRank", /(?:^|\s)PR\s*\(Percentile Rank\)\s*(\d+(?:\.\d+)?)(?=\s|$)/i]
    ];
    for (const [metric, pattern] of patterns) {
      const match = pattern.exec(results);
      if (match) values[metric] = Number(match[1]);
    }
    if (assessmentKind === "Star Reading" && resultKind === assessmentKind) {
      const irl = /(?:^|\s)IRL\s*\(Instructional Reading Level\)\s*(PHS|PP|P|\d+(?:\.\d+)?)(?=\s|$)/i.exec(results);
      const zpd = /(?:^|\s)ZPD\s*\(Zone of Proximal Development\)\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)(?=\s|$)/i.exec(results);
      if (irl) values.instructionalReadingLevel = irl[1].toUpperCase();
      if (zpd) {
        values.zoneOfProximalDevelopment = `${zpd[1]} - ${zpd[2]}`;
        if (Number(zpd[1]) > Number(zpd[2])) studentIssues.push("ZPD lower bound exceeds its upper bound.");
      }
    }
    if (!Object.keys(values).length) studentIssues.push("No recognized Star Math or Star Reading score values were found.");
    if (typeof values.percentileRank === "number" && (values.percentileRank < 0 || values.percentileRank > 99 || !Number.isInteger(values.percentileRank))) {
      studentIssues.push("Percentile Rank must be a whole number from 0 to 99.");
    }
    students.push({ assessmentKind, pageNumber: page.pageNumber, studentName: name[1].trim(), grade: dateBlock?.[2] ?? "", testDate: date?.testDate ?? "", schoolYear: date?.schoolYear ?? "", season: date?.season ?? "", values, issues: studentIssues });
  }
  if (!students.length) issues.push("No Star Math or Star Reading student reports were found. Select the original Instructional Planning - Student Report PDF export.");
  return { id, fileName, students, issues };
}

export function reviewReportImport(documents: ReportPdfDocument[], selection: ReportImportSelection, workspace: ReportImportWorkspace) {
  const { schoolYear, grade, assessmentId, roundId } = selection;
  const template = workspace.templates.find((item) => item.id === assessmentId);
  const assessment = template ? reportAssessmentForYear(template, schoolYear) : undefined;
  const assessmentKind = assessment ? starAssessmentKind(assessment) : null;
  const round = assessment?.rounds.find((item) => item.id === roundId);
  const issues: string[] = [];
  if (!workspace.schoolYears.includes(schoolYear)) issues.push("Choose an existing school year.");
  if (workspace.lockedOverviewYears?.includes(schoolYear)) issues.push(`${schoolYear} is locked. Unlock the year before importing.`);
  if (!assessmentKind) issues.push("PDF score extraction currently supports Star Math and Star Reading assessments.");
  if (!round) issues.push("Choose an assessment round.");
  const season = round ? roundSeason(round) : null;
  if (round && !season) issues.push("The selected round has no recognizable season or month. Set its month in Assessment Builder before importing.");
  const columns: ReportImportColumn[] = [];
  if (assessment && round) {
    const sections = sectionsForAssessmentRound(assessment, round, grade);
    for (const field of assessment.fields) {
      if (field.dataType === "file" || !assessmentFieldAppliesToGrade(field, grade) || (field.roundIds?.length && !field.roundIds.includes(round.id))) continue;
      const fieldSections = field.sectionIds?.length ? sections.filter((section) => field.sectionIds?.includes(section.id)) : [undefined];
      for (const section of fieldSections) columns.push({ key: assessmentValueKey(assessment, round, field, section), field, section, metric: metricForField(field, assessmentKind) });
    }
  }
  if (!columns.some((column) => column.metric)) issues.push(`No matching score columns are configured. Add PR, SS / Scaled Score, or Projected SS${assessmentKind === "Star Reading" ? ", IRL, or ZPD" : ""} to this assessment round.`);
  const unknownRequired = columns.filter((column) => !column.metric && column.field.isRequired);
  if (unknownRequired.length) issues.push(`Required fields cannot be extracted: ${unknownRequired.map((column) => column.field.name).join(", ")}.`);
  const byMetric = new Map<StarReportMetric, number>();
  columns.forEach(({ metric }) => { if (metric) byMetric.set(metric, (byMetric.get(metric) ?? 0) + 1); });
  if ([...byMetric.values()].some((count) => count > 1)) issues.push("Multiple assessment columns match the same report metric. Make the field mappings unambiguous in Assessment Builder.");
  const studentsById = new Map(workspace.rows.map((student) => [student.id, student]));
  const roster = workspace.placements.filter((placement) => placement.schoolYear === schoolYear && placement.grade === grade);
  const rows: ReportImportReviewRow[] = documents.flatMap((document) => document.students.map((source) => {
    // File/page warnings must not invalidate other successfully parsed reports.
    const rowIssues = [...source.issues];
    if (source.assessmentKind !== assessmentKind) rowIssues.push(`PDF assessment is ${source.assessmentKind ?? "unknown"}; selected assessment is ${assessmentKind ?? "unsupported"}.`);
    if (source.grade !== grade) rowIssues.push(`PDF grade is ${source.grade || "unknown"}; selected grade is ${grade}.`);
    if (source.schoolYear !== schoolYear) rowIssues.push(`PDF test year is ${source.schoolYear || "unknown"}; selected year is ${schoolYear}.`);
    if (season && source.season && source.season !== season) rowIssues.push(`The ${source.testDate} test date does not match ${round?.label}.`);
    const matches = roster.filter((placement) => reportStudentNameKey(studentsById.get(placement.studentId)?.student ?? "") === reportStudentNameKey(source.studentName));
    if (!matches.length) rowIssues.push(`No matching student in Grade ${grade} for ${schoolYear}.`);
    if (matches.length > 1) rowIssues.push("More than one student matches this name; resolve the duplicate before importing.");
    const placement = matches.length === 1 ? matches[0] : undefined;
    const student = placement ? studentsById.get(placement.studentId) : undefined;
    const values: Record<string, AssessmentValue> = {};
    const previousValues: Record<string, AssessmentValue> = {};
    for (const column of columns) {
      if (student && assessment && round) previousValues[column.key] = entryValue(student, assessment, round, column.field, column.section, { schoolYear, grade }) ?? null;
      if (!column.metric) continue;
      const value = source.values[column.metric];
      if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) { rowIssues.push(`${column.field.name} is missing from the PDF.`); continue; }
      const validation = validateAssessmentValue(value, column.field);
      if (!validation.valid) {
        const readingText = column.metric === "instructionalReadingLevel" || column.metric === "zoneOfProximalDevelopment";
        rowIssues.push(validation.error + (readingText ? ` Configure ${column.field.name} as Text to preserve report levels and ranges.` : ""));
        continue;
      }
      values[column.key] = validation.value;
    }
    return { id: `${document.id}:${source.pageNumber}`, documentId: document.id, fileName: document.fileName, pageNumber: source.pageNumber, sourceName: source.studentName, studentId: student?.id, studentName: student?.student ?? source.studentName, homeroom: placement?.homeroom ?? "", testDate: source.testDate, values, previousValues, issues: rowIssues };
  }));
  const counts = new Map<string, number>();
  rows.forEach((row) => { if (row.studentId && !row.issues.length) counts.set(row.studentId, (counts.get(row.studentId) ?? 0) + 1); });
  rows.forEach((row) => { if (row.studentId && !row.issues.length && (counts.get(row.studentId) ?? 0) > 1) row.issues.push("This student appears more than once in the selected PDFs. Remove the extra file or report before importing."); });
  return { assessment, round, columns, rows, issues, unmatchedFields: columns.filter((column) => !column.metric).map((column) => column.field.name) };
}

export function reportAttentionCsv(documents: ReportPdfDocument[], selection: ReportImportSelection, review: ReturnType<typeof reviewReportImport>) {
  const context = [selection.schoolYear, selection.grade, review.assessment?.name ?? selection.assessmentId, review.round?.label ?? selection.roundId];
  const includeReading = (review.assessment && starAssessmentKind(review.assessment) === "Star Reading") || documents.some((document) => document.students.some((student) => student.assessmentKind === "Star Reading"));
  const records: Array<Array<string | number>> = review.rows.filter((row) => review.issues.length || row.issues.length).map((row) => {
    const source = documents.find((document) => document.id === row.documentId)?.students.find((student) => student.pageNumber === row.pageNumber);
    return [...context, row.sourceName, row.studentId ? row.studentName : "", row.homeroom, row.fileName, row.pageNumber,
      row.testDate, source?.schoolYear ?? "", source?.grade ?? "", source?.values.scaledScore ?? "",
      source?.values.projectedScore ?? "", source?.values.percentileRank ?? "",
      ...(includeReading ? [source?.values.instructionalReadingLevel ?? "", source?.values.zoneOfProximalDevelopment ?? ""] : []),
      [...review.issues, ...row.issues].join(" ")];
  });
  for (const document of documents) {
    for (const issue of document.issues) {
      records.push([...context, "", "", "", document.fileName, issue.match(/^Page (\d+):/)?.[1] ?? "", "", "", "", "", "", "", ...(includeReading ? ["", ""] : []), issue]);
    }
  }
  if (!records.length) return null;
  const header = ["Selected Year", "Selected Grade", "Assessment", "Round", "PDF Student Name", "Matched Student Name", "Home Room",
    "PDF File", "Page", "Test Date", "PDF Year", "PDF Grade", "Scaled Score", "Projected Scaled Score", "Percentile Rank",
    ...(includeReading ? ["Instructional Reading Level", "Zone of Proximal Development"] : []), "Needs Attention"];
  // Quote all fields and neutralize spreadsheet formulas in untrusted PDF text.
  const cell = (value: string | number) => {
    const text = String(value);
    const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return { count: records.length, csv: "\uFEFF" + [header, ...records].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n" };
}

export function applyReportImport(request: ReportImportRequest, workspace: ReportImportWorkspace) {
  const review = reviewReportImport(request.documents, request.selection, workspace);
  if (review.issues.length || !review.assessment || !review.round) throw new Error(review.issues.join(" ") || "The assessment is unavailable.");
  const selected = new Set(request.selectedRowIds);
  const requestedRows = review.rows.filter((row) => selected.has(row.id));
  const reviewedRows = requestedRows.filter((row) => !row.issues.length && row.studentId);
  if (!selected.size || requestedRows.length !== selected.size || !reviewedRows.length) {
    throw new Error("Select only verified student reports. Review the flagged records before importing.");
  }
  const selectedByStudent = new Map(reviewedRows.map((row) => [row.studentId, row]));
  let dataCellCount = 0;
  const updatedRows: Array<{ studentId: string; previousRow: OrfResultRow; nextRow: OrfResultRow }> = [];
  const rows = workspace.rows.map((row) => {
    const reviewed = selectedByStudent.get(row.id);
    if (!reviewed) return row;
    const assessmentValues = { ...row.assessmentValues };
    for (const column of review.columns) {
      if (!Object.hasOwn(reviewed.values, column.key)) continue;
      const key = assessmentValueKey(review.assessment!, review.round!, column.field, column.section, request.selection);
      if (assessmentValues[key] === reviewed.values[column.key]) continue;
      assessmentValues[key] = reviewed.values[column.key];
      dataCellCount += 1;
    }
    if (JSON.stringify(assessmentValues) === JSON.stringify(row.assessmentValues ?? {})) return row;
    const nextRow = { ...row, assessmentValues };
    updatedRows.push({ studentId: row.id, previousRow: row, nextRow });
    return nextRow;
  });
  return { rows, updatedRows, dataCellCount, reviewedRows };
}
