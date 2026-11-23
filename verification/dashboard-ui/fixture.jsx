import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Dashboard, StudentReport } from "acceptance:views";
import { ClassroomGroupsPanel } from "@/components/classroom-groups-panel";
import { useClassroomGroups } from "@/lib/classroom-group-store";
import { assessmentValueKey } from "@/lib/assessment-entry";
import { hydrateOrfRow } from "@/lib/sample-results";
import "@/app/globals.css";

const query = new URLSearchParams(location.search);
const expanded = query.has("pickers");
const schoolYears = ["2026-2027", "2025-2026", "2024-2025"];
const windowNames = query.has("dense")
  ? Array.from({ length: 12 }, (_, i) => "Window " + (i + 1)) : ["Fall", "Spring"];
const rounds = windowNames.map(label => ({ label, id: label.toLowerCase(), month: label }));
const sections = ["Recall", "Reasoning", "Transfer"].map(name => ({ name, id: name.toLowerCase(), roundIds: rounds.map(r => r.id) }));
const field = { id: "score", name: "Diagnostic score", slug: "score", dataType: "integer",
  visibility: "evaluators", sectionIds: sections.map(s => s.id), isRequired: false, isCalculated: false };
const fields = expanded ? [field, { ...field, id: "fluency", slug: "fluency", name: "Fluency score" }] : [field];
const template = { id: "synthetic-diagnostic", name: "Synthetic diagnostic", category: "Custom",
  description: "Verification only", gradeScope: "All", rounds, fields, sections };
const alternate = { ...template, id: "synthetic-baseline", name: "Synthetic baseline" };
const templates = [template, alternate];
const placements = [];
const roster = [["Ada Example", "3A", "3", 0], [query.has("duplicates") ? "Ada Example" : "Ben Example", "3B", "3", 20],
  ["Cy Example", expanded ? "9A" : "7C", expanded ? "9" : "7", 80]];
if (expanded) roster.unshift(["Drew Example", "11A", "11", 50], ["Eli Example", "10B", "10", 60],
  ["Fran Example", "10A", "10", 70]);
const rows = roster.map(([student, homeroom, grade, base], index) => {
  const id = "synthetic-" + index;
  const assessmentValues = {};
  schoolYears.forEach((schoolYear, y) => {
    placements.push({ studentId: id, schoolYear, grade, homeroom });
    if (y === 2) return;
    templates.forEach((assessment, a) => rounds.forEach((round, r) => sections.forEach((section, s) => {
      fields.forEach((item, f) => {
        if (query.has("missingRecall") && id === "synthetic-1" && schoolYear === "2026-2027" &&
          assessment === template && round.id === "spring" && section.id === "recall" && item === field) return;
        assessmentValues[assessmentValueKey(assessment, round, item, section, { schoolYear, grade })] =
          base + y * 10 + r * 3 + s + a * 100 + f * 200;
      });
    })));
  });
  return hydrateOrfRow({ id, student, homeroom, assessmentValues,
    septP1Wpm: null, septP1Epm: null, septP2Wpm: null, septP2Epm: null, septP3Wpm: null, septP3Epm: null });
});
function Fixture() {
  const [uid, setUid] = useState(query.get("account") === "second" ? "synthetic-second" : "synthetic-first");
  const list = useClassroomGroups(uid);
  const restricted = query.has("restricted");
  const isAdmin = query.has("admin");
  window.fixtureAccount = { uid, isAdmin };
  const props = { uid, isAdmin, rows: restricted ? rows.slice(1) : rows,
    placements: restricted ? placements.filter(p => p.studentId !== rows[0].id) : placements,
    templates, schoolYears, classroomGroups: expanded ? [
      { id: "junior", name: "Junior team", grades: ["3", "9"] },
      { id: "senior", name: "Senior team", grades: ["10", "11"] }
    ] : list.groups };
  return <>
    {query.has("switchable") && <button type="button" onClick={() =>
      setUid(current => current === "synthetic-first" ? "synthetic-second" : "synthetic-first")}>Switch fixture account</button>}
    {query.has("groups") && <ClassroomGroupsPanel list={list} onChanged={() => {}} />}
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block"><span>Student Evaluations</span><strong>Console</strong></div>
        <nav className="workspace-nav" aria-label="Student Evaluation views">
          <button className="workspace-link" type="button" onClick={() => location.assign("/")}>Dashboard</button>
          <button className="workspace-link" type="button" onClick={() => location.assign("/?report")}>Student Report</button>
        </nav>
      </aside>
      <section className="workspace"><header className="topbar"><h1>{query.has("report") ? "Student Report" : "Dashboard"}</h1></header>
        {query.has("report") ? <StudentReport {...props} recordAudit={() => {}} /> : <Dashboard {...props} />}
      </section>
    </main>
  </>;
}
createRoot(document.querySelector("#root")).render(<Fixture />);
