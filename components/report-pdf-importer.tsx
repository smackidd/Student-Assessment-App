"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PDF_IMPORT_LIMITS, readReportPdf } from "@/lib/pdf-text";
import { SUPPORTED_GRADES } from "@/lib/team-assignments";
import {
  isStarMathAssessment, parseStarReportPdf, reportAssessmentForYear, reportAttentionCsv, reviewReportImport,
  type ReportImportRequest, type ReportImportSelection, type ReportImportWorkspace, type ReportPdfDocument
} from "@/lib/report-pdf-import";

export type ReportImportResult = { studentCount: number; valueCount: number; auditSaved: boolean };

type Props = {
  workspace: ReportImportWorkspace;
  initialYear: string;
  initialGrade: string;
  disabled?: boolean;
  onImport: (request: ReportImportRequest) => Promise<ReportImportResult>;
};

export function ReportPdfImporter({ workspace, initialYear, initialGrade, disabled, onImport }: Props) {
  const [selection, setSelection] = useState<ReportImportSelection>(() => {
    const assessment = workspace.templates.find(isStarMathAssessment) ?? workspace.templates[0];
    const definition = assessment && reportAssessmentForYear(assessment, initialYear);
    return { schoolYear: initialYear, grade: initialGrade, assessmentId: assessment?.id ?? "", roundId: definition?.rounds[0]?.id ?? "" };
  });
  const [documents, setDocuments] = useState<ReportPdfDocument[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReportImportResult | null>(null);
  const controller = useRef<AbortController | null>(null);
  const operationInFlight = useRef(false);
  const fileSizes = useRef(new Map<string, number>());
  const selectAll = useRef<HTMLInputElement>(null);
  const review = useMemo(() => reviewReportImport(documents, selection, workspace), [documents, selection, workspace]);
  const readyRows = review.issues.length ? [] : review.rows.filter((row) => !row.issues.length);
  const selectedRows = readyRows.filter((row) => !excluded.has(row.id));
  const attentionReport = useMemo(() => reportAttentionCsv(documents, selection, review), [documents, selection, review]);
  const busy = Boolean(progress) || saving || disabled;

  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedRows.length > 0 && selectedRows.length < readyRows.length;
  }, [selectedRows.length, readyRows.length]);

  function changeSelection(patch: Partial<ReportImportSelection>) {
    const next = { ...selection, ...patch };
    const template = workspace.templates.find((item) => item.id === next.assessmentId);
    const rounds = template ? reportAssessmentForYear(template, next.schoolYear).rounds : [];
    if (!rounds.some((round) => round.id === next.roundId)) next.roundId = rounds[0]?.id ?? "";
    setSelection(next);
    setExcluded(new Set());
    setError("");
    setResult(null);
  }

  async function scanFiles(files: File[]) {
    if (!files.length || busy || operationInFlight.current) return;
    setError("");
    setResult(null);
    if (files.length + documents.length > PDF_IMPORT_LIMITS.files) {
      setError("Select up to 20 PDFs per batch.");
      return;
    }
    if (files.reduce((sum, file) => sum + file.size, 0) + [...fileSizes.current.values()].reduce((sum, size) => sum + size, 0) > PDF_IMPORT_LIMITS.totalBytes) {
      setError("The selected PDFs exceed the 100 MB batch limit.");
      return;
    }
    operationInFlight.current = true;
    const abort = new AbortController();
    controller.current = abort;
    try {
      for (const [index, file] of files.entries()) {
        if (abort.signal.aborted) break;
        setProgress(`Reading PDF ${index + 1} of ${files.length}: ${file.name}`);
        const id = crypto.randomUUID();
        let document: ReportPdfDocument;
        try {
          document = parseStarReportPdf(await readReportPdf(file, abort.signal), file.name, id);
        } catch (scanError) {
          if (abort.signal.aborted) break;
          document = { id, fileName: file.name, students: [], issues: [scanError instanceof Error ? scanError.message : "This PDF could not be read."] };
        }
        if (abort.signal.aborted) break;
        fileSizes.current.set(id, file.size);
        setDocuments((current) => [...current, document]);
      }
    } finally {
      operationInFlight.current = false;
      if (!abort.signal.aborted) setProgress("");
    }
  }

  function downloadAttentionReport() {
    if (!attentionReport) return;
    const url = URL.createObjectURL(new Blob([attentionReport.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `report-import-${selection.schoolYear}-grade-${selection.grade}-needs-attention.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importVerified() {
    if (!selectedRows.length || busy || operationInFlight.current || result) return;
    operationInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      // Start the download within the click gesture, before awaiting Firebase.
      downloadAttentionReport();
      setResult(await onImport({ selection, documents, selectedRowIds: selectedRows.map((row) => row.id) }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The import could not be saved. No local changes have been applied.");
    } finally {
      operationInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="pdf-import-layout" aria-label="PDF report import">
      <div className="panel pdf-import-controls">
        <h2>Import reports</h2>
        <label>Year
          <select value={selection.schoolYear} disabled={busy} onChange={(event) => changeSelection({ schoolYear: event.target.value })}>
            {workspace.schoolYears.map((year) => <option key={year}>{year}</option>)}
          </select>
        </label>
        <label>Grade
          <select value={selection.grade} disabled={busy} onChange={(event) => changeSelection({ grade: event.target.value })}>
            {SUPPORTED_GRADES.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}
          </select>
        </label>
        <label>Assessment
          <select value={selection.assessmentId} disabled={busy} onChange={(event) => changeSelection({ assessmentId: event.target.value })}>
            {workspace.templates.map((template) => <option key={template.id} value={template.id}>{reportAssessmentForYear(template, selection.schoolYear).name}</option>)}
          </select>
        </label>
        <label>Round
          <select value={selection.roundId} disabled={busy} onChange={(event) => changeSelection({ roundId: event.target.value })}>
            {!review.assessment?.rounds.length && <option value="">No rounds configured</option>}
            {review.assessment?.rounds.map((round) => <option key={round.id} value={round.id}>{round.label}</option>)}
          </select>
        </label>
        <label>Select report files
          <input type="file" multiple accept="application/pdf,.pdf" disabled={busy} onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void scanFiles(files);
          }} />
        </label>
        <p className="pdf-import-help">Star Math and Star Reading PDFs, up to 20 files. Review extracted scores before saving. Original PDFs stay on your device.</p>
        {documents.length > 0 && <ul className="pdf-import-files" aria-label="Selected PDFs">
          {documents.map((document) => <li key={document.id}>
            <span>{document.fileName}<small>{document.students.length} student reports</small></span>
            <button type="button" className="small-action ghost" disabled={busy} aria-label={`Remove ${document.fileName}`} onClick={() => {
              setDocuments((current) => current.filter((item) => item.id !== document.id));
              fileSizes.current.delete(document.id);
              setResult(null);
            }}>Remove</button>
          </li>)}
        </ul>}
      </div>
      <div className="panel pdf-import-review" aria-busy={Boolean(progress) || saving}>
        <div className="pdf-import-heading">
          <div><p className="eyebrow">Storage Queue</p><h2>Verify extracted scores</h2></div>
          <button type="button" className="primary-action" disabled={busy || !selectedRows.length || Boolean(result)} onClick={() => void importVerified()}>
            {saving ? "Saving..." : "Import verified rows"}
          </button>
        </div>
        <div className="pdf-import-messages" aria-live="polite">
          {progress && <p role="status">{progress}</p>}
          {error && <p className="pdf-import-error" role="alert">{error}</p>}
          {review.issues.map((issue) => <p className="pdf-import-error" key={issue}>{issue}</p>)}
          {documents.flatMap((document) => document.issues.map((issue) => <p className="pdf-import-error" key={`${document.id}:${issue}`}>{document.fileName}: {issue}</p>))}
          {review.unmatchedFields.length > 0 && <p>Not present in this report; existing values will be kept: {review.unmatchedFields.join(", ")}.</p>}
          {attentionReport && <p>
            {attentionReport.count} report row{attentionReport.count === 1 ? "" : "s"} or file issue{attentionReport.count === 1 ? "" : "s"} {result ? "skipped." : "will be skipped and exported to CSV when importing."}{" "}
            <button type="button" className="small-action ghost" disabled={busy} onClick={downloadAttentionReport}>Download attention CSV</button>
          </p>}
          {result ? <p role="status">Import complete. {result.studentCount} student{result.studentCount === 1 ? "" : "s"} reviewed; {result.valueCount} value{result.valueCount === 1 ? "" : "s"} saved to Firebase. {result.valueCount === 0 ? "All selected scores already match the saved values. No changes were needed." : result.auditSaved ? "Changes can be reverted from the Audit Log." : "The audit entry is pending. Retry it in the Audit Log."}</p>
            : review.rows.length > 0 && <p>{selectedRows.length} selected; {review.rows.length - readyRows.length} need attention. Existing scores in the selected year and round will be replaced.</p>}
        </div>
        <div className="report-table-scroll pdf-import-table-scroll" role="region" aria-label="Extracted report values" tabIndex={0}>
          {review.rows.length ? <table className="report-assessment-table pdf-import-table">
            <thead>
              <tr>
                <th rowSpan={3}><input ref={selectAll} type="checkbox" aria-label="Select all verified reports" checked={readyRows.length > 0 && selectedRows.length === readyRows.length} disabled={busy || !readyRows.length || Boolean(result)} onChange={(event) => setExcluded(event.target.checked ? new Set() : new Set(readyRows.map((row) => row.id)))} /></th>
                <th rowSpan={3}>Student / PDF source</th><th rowSpan={3}>Home room</th><th rowSpan={3}>Test date</th><th rowSpan={3}>Verification</th>
                <th colSpan={Math.max(1, review.columns.length)}>{selection.schoolYear} / {review.assessment?.name}</th>
              </tr>
              <tr><th colSpan={Math.max(1, review.columns.length)} style={{ background: review.round?.color }}>{review.round?.label}</th></tr>
              <tr>{review.columns.length ? review.columns.map((column) => <th key={column.key} style={{ background: review.round?.color }}>{column.section && <small>{column.section.name}</small>}{column.field.name}</th>) : <th>No matching fields</th>}</tr>
            </thead>
            <tbody>{review.rows.map((row) => {
              const valid = !review.issues.length && !row.issues.length;
              return <tr key={row.id} className={valid ? "" : "pdf-import-invalid"}>
                <td><input type="checkbox" aria-label={`Import ${row.studentName} from page ${row.pageNumber}`} checked={valid && !excluded.has(row.id)} disabled={!valid || busy || Boolean(result)} onChange={(event) => setExcluded((current) => { const next = new Set(current); if (event.target.checked) next.delete(row.id); else next.add(row.id); return next; })} /></td>
                <th scope="row">{row.studentName}<small>{row.fileName}, page {row.pageNumber}</small></th>
                <td>{row.homeroom || "-"}</td><td>{row.testDate || "-"}</td>
                <td>{valid ? result && !excluded.has(row.id) ? "Saved" : "Verified" : row.issues.join(" ") || "Check selections above."}</td>
                {review.columns.map((column) => <td key={column.key} style={{ background: review.round?.color }}>
                  {String((column.metric ? row.values[column.key] : row.previousValues[column.key]) ?? "-")}
                  {!column.metric && <small>Unchanged</small>}
                  {!result && column.metric && row.previousValues[column.key] != null && row.previousValues[column.key] !== row.values[column.key] && <small>Was {row.previousValues[column.key]}</small>}
                </td>)}
                {!review.columns.length && <td>-</td>}
              </tr>;
            })}</tbody>
          </table> : <div className="empty-state">Select PDFs to review student matches and extracted assessment values.</div>}
        </div>
      </div>
    </section>
  );
}
