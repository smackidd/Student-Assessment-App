"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellValueChangedEvent,
  type ColDef
} from "ag-grid-community";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User
} from "firebase/auth";
import {
  assessmentTemplates,
  emptyCustomTemplate,
  type AssessmentDataType,
  type AssessmentFieldTemplate,
  type AssessmentRoundTemplate,
  type AssessmentSectionTemplate,
  type AssessmentTemplate,
} from "@/lib/assessment-templates";
import {
  loadPrototypeWorkspaceState,
  savePrototypeWorkspaceState,
  saveStudentsToDatabase
} from "@/lib/student-database";
import { firebaseApp } from "@/lib/firebase";
import { hydrateOrfRow, initialOrfRows, type OrfResultRow } from "@/lib/sample-results";

ModuleRegistry.registerModules([AllCommunityModule]);

const dataTypes: AssessmentDataType[] = ["integer", "percentage", "letter", "text", "date", "file", "calculated"];
const dashboardYears = ["2026-2027", "2025-2026", "2024-2025"];
const roles = ["Principal", "Vice Principal", "Evaluator"] as const;
const savedCalculations = ["custom", "orf_cwpm", "median", "orf_percentile", "average", "sum", "count", "min", "max"];
const conditionOperators = ["+", "-", "*", "/", "AND", "OR", "<", ">", "=", "!="];
const comparisonOperators = ["<", ">", "=", "!="];
const pastelRoundColors = [
  "#ffe3d8",
  "#fff0bf",
  "#def5df",
  "#d9f4ef",
  "#dceeff",
  "#e7e2ff",
  "#f6ddff",
  "#ffddeb",
  "#f1ead8",
  "#dff3ff",
  "#e9f5c8",
  "#f7e0d2"
];

type AppView = "overview" | "dashboard" | "assessment" | "report" | "files" | "profile";
type AssessmentPageTab = "builder" | "entry";
type UserRole = (typeof roles)[number];
type ProfilePageTab = "profile" | "audit" | "team";
type StudentNotePermission = "admin_only" | "all";
type SaveStatus = "saved" | "dirty" | "saving" | "error";
type RecordAudit = (eventType: string, entityType: string, entityLabel: string, description: string) => void;
type OverviewDialog =
  | { type: "add" }
  | { type: "move"; studentId: string }
  | { type: "delete"; studentId: string }
  | null;

export default function StudentEvaluationApp() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [templates, setTemplates] = useState<AssessmentTemplate[]>(assessmentTemplates);
  const [selectedId, setSelectedId] = useState(assessmentTemplates[0].id);
  const [activeView, setActiveView] = useState<AppView>("overview");
  const [assessmentPageTab, setAssessmentPageTab] = useState<AssessmentPageTab>("entry");
  const [profilePageTab, setProfilePageTab] = useState<ProfilePageTab>("profile");
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>("Vice Principal");
  const [userProfile, setUserProfile] = useState({ name: "", email: "", grade: "3", homeroom: "3A" });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [organizationAccess, setOrganizationAccess] = useState<"checking" | "active" | "uninvited">("checking");
  const [orfRows, setOrfRows] = useState<OrfResultRow[]>(initialOrfRows);
  const [schoolYears, setSchoolYears] = useState(dashboardYears);
  const [selectedOverviewYear, setSelectedOverviewYear] = useState(dashboardYears[0]);
  const [selectedOverviewGrade, setSelectedOverviewGrade] = useState("3");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveMessage, setSaveMessage] = useState("No unsaved table changes.");
  const [unsavedAlertDismissed, setUnsavedAlertDismissed] = useState(false);
  const [databaseStudentNames, setDatabaseStudentNames] = useState(() => uniqueStudentNames(initialOrfRows));
  const [overviewDuplicateConflicts, setOverviewDuplicateConflicts] = useState<DuplicateStudentNameConflict[]>([]);
  const [lastSavedWorkspaceState, setLastSavedWorkspaceState] = useState<SavedWorkspaceState | null>(null);
  const [lockedOverviewYears, setLockedOverviewYears] = useState<string[]>([]);
  const [overviewPlacements, setOverviewPlacements] = useState<StudentPlacement[]>(
    initialOrfRows.map((row) => ({
      studentId: row.id,
      schoolYear: dashboardYears[0],
      grade: "3",
      homeroom: row.homeroom
    }))
  );
  const [uploadedReports, setUploadedReports] = useState<UploadedReport[]>([]);
  const [activeNoteStudentId, setActiveNoteStudentId] = useState<string | null>(null);
  const [overviewDialog, setOverviewDialog] = useState<OverviewDialog>(null);
  const [auditEvents, setAuditEvents] = useState<AppAuditEvent[]>([
    {
      id: "audit-seed-1",
      eventType: "Project setup",
      entityType: "Firebase",
      entityLabel: "Data Connect and Storage",
      description: "Firebase project, Data Connect connector, Cloud SQL schema, and Storage rules are connected for this project.",
      createdAt: "2026-06-09T09:00:00.000Z",
      actor: "Codex"
    },
    {
      id: "audit-seed-2",
      eventType: "Assessment setup",
      entityType: "Assessment definition",
      entityLabel: "ORF",
      description: "Seeded ORF fields with locked CWPM, median, and percentile calculation fields.",
      createdAt: "2026-06-09T09:15:00.000Z",
      actor: "Codex"
    }
  ]);
  const [notes, setNotes] = useState<StudentNote[]>([
    {
      id: "note-1",
      studentId: "student-a",
      permission: "admin_only",
      body: "Share ORF trend with support team if winter median remains below target.",
      author: "VP",
      createdAt: "2026-06-09"
    },
    {
      id: "note-2",
      studentId: "student-d",
      permission: "all",
      body: "Retest after additional reading practice block.",
      author: "Evaluator",
      createdAt: "2026-06-09"
    }
  ]);
  const [draftField, setDraftField] = useState({
    name: "",
    dataType: "integer" as AssessmentDataType,
    isCalculated: false,
    calculationKey: "custom",
    calculationExpression: "",
    conditionLeft: "median",
    conditionOperator: "<",
    conditionRight: "50",
    conditionJoinOperator: "",
    conditionExtra: "",
    letterRanks: "",
    selectedRoundIds: [] as string[],
    selectedSectionIds: [] as string[]
  });

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? templates[0],
    [selectedId, templates]
  );
  const isAdmin = currentUserRole === "Principal" || currentUserRole === "Vice Principal";
  const activeNoteStudent = activeNoteStudentId
    ? orfRows.find((row) => row.id === activeNoteStudentId) ?? null
    : null;
  const activeOverviewRows = useMemo(
    () =>
      overviewPlacements
        .filter((placement) => placement.schoolYear === selectedOverviewYear && placement.grade === selectedOverviewGrade)
        .map((placement) => {
          const row = orfRows.find((studentRow) => studentRow.id === placement.studentId);
          return row ? { ...row, homeroom: placement.homeroom } : null;
        })
        .filter((row): row is OrfResultRow => Boolean(row)),
    [orfRows, overviewPlacements, selectedOverviewGrade, selectedOverviewYear]
  );
  const overviewHomerooms = useMemo(
    () =>
      Array.from(
        new Set(
          overviewPlacements
            .filter((placement) => placement.schoolYear === selectedOverviewYear && placement.grade === selectedOverviewGrade)
            .map((placement) => placement.homeroom)
        )
      ).sort(),
    [overviewPlacements, selectedOverviewGrade, selectedOverviewYear]
  );
  const lockedFieldCount = selected.fields.filter((field) => field.isCalculated).length;
  const evaluatorFieldCount = selected.fields.filter((field) => field.visibility === "evaluators").length;

  useEffect(() => {
    const auth = getAuth(firebaseApp);
    return onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      if (user) {
        const fallbackName = user.displayName || user.email?.split("@")[0] || "Team Member";
        setUserProfile((profile) => ({
          ...profile,
          name: profile.name || fallbackName,
          email: profile.email || user.email || ""
        }));
        setTeamMembers((current) =>
          current.length
            ? current
            : [
                {
                  id: user.uid,
                  name: fallbackName,
                  email: user.email || "",
                  role: "Vice Principal",
                  grade: "3",
                  homeroom: "3A",
                  status: "active"
                }
              ]
        );
      }
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!authReady || !authUser) return;
    const signedInUser = authUser;
    let cancelled = false;

    async function loadSavedStudents() {
      try {
        const savedState = await loadPrototypeWorkspaceState();
        if (cancelled) return;
        if (savedState) {
          setOrfRows(savedState.rows);
          setOverviewPlacements(savedState.placements);
          setTemplates(savedState.templates);
          setSchoolYears(savedState.schoolYears);
          setLastSavedWorkspaceState(savedState);
          setDatabaseStudentNames(uniqueStudentNames(savedState.rows));
          setLockedOverviewYears(savedState.lockedOverviewYears ?? []);
          setCurrentUserRole(savedState.currentUserRole ?? "Vice Principal");
          if (savedState.userProfile) setUserProfile(savedState.userProfile);
          if (savedState.teamMembers) {
            const activatedTeam = activateSignedInMember(savedState.teamMembers, signedInUser);
            setTeamMembers(activatedTeam.members);
            setOrganizationAccess(activatedTeam.access);
            if (activatedTeam.role) setCurrentUserRole(activatedTeam.role);
          } else {
            setOrganizationAccess("active");
          }
          setSaveStatus("saved");
          setSaveMessage("Loaded the saved table workspace from Firebase.");
          return;
        }

        setSaveStatus("saving");
        setSaveMessage("Migrating the starter assessment workspace to Firebase...");
        const starterState: SavedWorkspaceState = {
          rows: initialOrfRows,
          placements: initialOrfRows.map((row) => ({
            studentId: row.id,
            schoolYear: dashboardYears[0],
            grade: "3",
            homeroom: row.homeroom
          })),
          templates: assessmentTemplates,
          schoolYears: dashboardYears,
          lockedOverviewYears: [],
          currentUserRole,
          userProfile,
          teamMembers
        };
        await savePrototypeWorkspaceState(starterState);
        const result = await saveStudentsToDatabase(initialOrfRows);
        if (cancelled) return;
        setLastSavedWorkspaceState(starterState);
        setDatabaseStudentNames(uniqueStudentNames(initialOrfRows));
        setSaveStatus("saved");
        setSaveMessage(
          `Migrated starter data to Firebase. ${result.createdCount} student${result.createdCount === 1 ? "" : "s"} added; ${result.updatedCount} updated.`
        );
        setOrganizationAccess("active");
      } catch (error) {
        if (cancelled) return;
        setSaveStatus("error");
        setSaveMessage(error instanceof Error ? error.message : "Could not load saved students from Firebase.");
      }
    }

    loadSavedStudents();
    return () => {
      cancelled = true;
    };
  }, [authReady, authUser]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (saveStatus !== "dirty") return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveStatus]);

  useEffect(() => {
    if (isAdmin) return;
    if (activeView !== "dashboard" && activeView !== "assessment" && activeView !== "profile") {
      setActiveView("dashboard");
    }
    if (assessmentPageTab !== "entry") {
      setAssessmentPageTab("entry");
    }
  }, [activeView, assessmentPageTab, isAdmin]);

  function markUnsaved(message = "You have unsaved table changes.") {
    setSaveStatus("dirty");
    setSaveMessage(message);
    setUnsavedAlertDismissed(false);
  }

  function restoreLastSavedWorkspace() {
    if (!lastSavedWorkspaceState) {
      setOverviewDuplicateConflicts([]);
      setSaveStatus("saved");
      setSaveMessage("Discarded unsaved changes.");
      setUnsavedAlertDismissed(false);
      return;
    }

    setOrfRows(lastSavedWorkspaceState.rows);
    setOverviewPlacements(lastSavedWorkspaceState.placements);
    setTemplates(lastSavedWorkspaceState.templates);
    setSchoolYears(lastSavedWorkspaceState.schoolYears);
    setLockedOverviewYears(lastSavedWorkspaceState.lockedOverviewYears ?? []);
    setCurrentUserRole(lastSavedWorkspaceState.currentUserRole ?? "Vice Principal");
    if (lastSavedWorkspaceState.userProfile) setUserProfile(lastSavedWorkspaceState.userProfile);
    if (lastSavedWorkspaceState.teamMembers) setTeamMembers(lastSavedWorkspaceState.teamMembers);
    setDatabaseStudentNames(uniqueStudentNames(lastSavedWorkspaceState.rows));
    setOverviewDuplicateConflicts([]);
    setSaveStatus("saved");
    setSaveMessage("Discarded unsaved changes and restored the last saved workspace.");
    setUnsavedAlertDismissed(false);
  }

  function confirmUnsavedChanges() {
    if (saveStatus !== "dirty") return true;
    const shouldLeave = window.confirm("You have unsaved table changes. Leave this tab without saving?");
    if (shouldLeave) {
      restoreLastSavedWorkspace();
      return true;
    }
    return false;
  }

  function changeActiveView(view: AppView) {
    if (!confirmUnsavedChanges()) return;
    setActiveView(view);
  }

  function changeAssessmentTab(tab: AssessmentPageTab) {
    if (!confirmUnsavedChanges()) return;
    setAssessmentPageTab(tab);
  }

  async function saveTablesToFirebase() {
    setSaveStatus("saving");
    setSaveMessage("Saving table changes to Firebase...");
    try {
      if (activeView === "overview") {
        const savedState = await loadPrototypeWorkspaceState();
        const conflicts = findOverviewStudentNameConflicts(activeOverviewRows, selectedOverviewYear, savedState);

        if (conflicts.length) {
          setOverviewDuplicateConflicts(conflicts);
          setSaveStatus("dirty");
          setSaveMessage("You have unsaved table changes.");
          window.alert(
            `These names already exist in ${selectedOverviewYear}:\n\n${conflicts
              .map((conflict) => `${conflict.name} - Grade ${conflict.existingGrade}, HR ${conflict.existingHomeroom}`)
              .join("\n")}`
          );
          return;
        }

        setOverviewDuplicateConflicts([]);
      }

      const workspaceState: SavedWorkspaceState = {
        rows: orfRows,
        placements: overviewPlacements,
        templates,
        schoolYears,
        lockedOverviewYears,
        currentUserRole,
        userProfile,
        teamMembers
      };
      await savePrototypeWorkspaceState(workspaceState);
      const result = await saveStudentsToDatabase(orfRows);
      setLastSavedWorkspaceState(workspaceState);
      setDatabaseStudentNames(uniqueStudentNames(orfRows));
      setSaveStatus("saved");
      setSaveMessage(
        `Saved to Firebase. ${result.createdCount} new student${result.createdCount === 1 ? "" : "s"} added; ${result.updatedCount} updated.`
      );
      recordAudit("Saved table", "Firebase Data Connect", "Student table", "Saved visible student rows to the SQL Student table.");
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(error instanceof Error ? error.message : "Firebase save failed.");
    }
  }

  function updateSelected(patch: Partial<AssessmentTemplate>) {
    setTemplates((current) =>
      current.map((template) => (template.id === selected.id ? { ...template, ...patch } : template))
    );
    markUnsaved("Assessment Builder changed. Save to update Firebase.");
  }

  function addCustomAssessment() {
    const id = `custom-${templates.length + 1}`;
    const custom = {
      ...emptyCustomTemplate,
      id,
      name: `Custom Assessment ${templates.length + 1}`,
      rounds: emptyCustomTemplate.rounds.map((round) => ({ ...round }))
    };
    setTemplates((current) => [...current, custom]);
    setSelectedId(id);
    setActiveView("assessment");
    setAssessmentPageTab("builder");
    recordAudit(
      "Created assessment",
      "Assessment definition",
      custom.name,
      "Created a new configurable assessment shell for VP setup."
    );
  }

  function addField() {
    const name = draftField.name.trim();
    if (!name) return;

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

    const nextField: AssessmentFieldTemplate = {
      id: `${selected.id}-${slug}-${selected.fields.length + 1}`,
      name,
      slug,
      dataType: draftField.isCalculated ? "calculated" : draftField.dataType,
      isRequired: false,
      isCalculated: draftField.isCalculated,
      calculationKey: draftField.isCalculated ? draftField.calculationKey.trim() || "custom" : undefined,
      calculationExpression: draftField.isCalculated ? draftField.calculationExpression.trim() : undefined,
      calculationCondition: draftField.isCalculated
        ? {
            left: draftField.conditionLeft,
            operator: draftField.conditionOperator,
            right: draftField.conditionRight,
            joinOperator: draftField.conditionJoinOperator,
            extra: draftField.conditionExtra
          }
        : undefined,
      letterRanks: draftField.dataType === "letter" ? draftField.letterRanks.trim() : undefined,
      roundIds: draftField.selectedRoundIds.length ? draftField.selectedRoundIds : undefined,
      sectionIds: draftField.selectedSectionIds.length ? draftField.selectedSectionIds : undefined,
      visibility: "evaluators"
    };

    updateSelected({ fields: [...selected.fields, nextField] });
    recordAudit(
      draftField.isCalculated ? "Added formula field" : "Added field",
      "Assessment field",
      `${selected.name} / ${name}`,
      `Added ${nextField.dataType} field.`
    );
    setDraftField({
      name: "",
      dataType: "integer",
      isCalculated: false,
      calculationKey: "custom",
      calculationExpression: "",
      conditionLeft: "median",
      conditionOperator: "<",
      conditionRight: "50",
      conditionJoinOperator: "",
      conditionExtra: "",
      letterRanks: "",
      selectedRoundIds: [],
      selectedSectionIds: []
    });
  }

  function removeField(fieldId: string) {
    const removedField = selected.fields.find((field) => field.id === fieldId);
    updateSelected({ fields: selected.fields.filter((field) => field.id !== fieldId) });
    if (removedField) {
      recordAudit(
        "Removed field",
        "Assessment field",
        `${selected.name} / ${removedField.name}`,
        "Removed a configurable assessment field from the active definition."
      );
    }
  }

  function addRound() {
    const roundNumber = selected.rounds.length + 1;
    const nextRound: AssessmentRoundTemplate = {
      id: `round-${Date.now()}`,
      label: `Round ${roundNumber}`,
      month: "Custom",
      color: pastelRoundColors[(roundNumber - 1) % pastelRoundColors.length]
    };
    updateSelected({ rounds: [...selected.rounds, nextRound] });
    recordAudit("Added round", "Assessment round", `${selected.name} / ${nextRound.label}`, "Added a new assessment round.");
  }

  function updateRound(roundId: string, patch: Partial<AssessmentRoundTemplate>) {
    const round = selected.rounds.find((item) => item.id === roundId);
    updateSelected({
      rounds: selected.rounds.map((item) => (item.id === roundId ? { ...item, ...patch } : item))
    });
    if (round && patch.label) {
      recordAudit(
        "Edited round",
        "Assessment round",
        `${selected.name} / ${patch.label}`,
        `Changed round title from ${round.label} to ${patch.label}.`
      );
    }
  }

  function removeRound(roundId: string) {
    const removedRound = selected.rounds.find((round) => round.id === roundId);
    updateSelected({ rounds: selected.rounds.filter((round) => round.id !== roundId) });
    if (removedRound) {
      recordAudit(
        "Removed round",
        "Assessment round",
        `${selected.name} / ${removedRound.label}`,
        "Removed an assessment round."
      );
    }
  }

  function addSection() {
    const nextSection: AssessmentSectionTemplate = {
      id: `section-${Date.now()}`,
      name: `Section ${(selected.sections?.length ?? 0) + 1}`,
      roundIds: selected.rounds[0] ? [selected.rounds[0].id] : []
    };
    updateSelected({ sections: [...(selected.sections ?? []), nextSection] });
    recordAudit("Added section", "Assessment section", `${selected.name} / ${nextSection.name}`, "Added an optional assessment window section.");
  }

  function updateSection(sectionId: string, patch: Partial<AssessmentSectionTemplate>) {
    updateSelected({
      sections: (selected.sections ?? []).map((section) => (section.id === sectionId ? { ...section, ...patch } : section))
    });
  }

  function removeSection(sectionId: string) {
    const removed = selected.sections?.find((section) => section.id === sectionId);
    updateSelected({
      sections: (selected.sections ?? []).filter((section) => section.id !== sectionId),
      fields: selected.fields.map((field) => ({
        ...field,
        sectionIds: field.sectionIds?.filter((id) => id !== sectionId)
      }))
    });
    if (removed) {
      recordAudit("Removed section", "Assessment section", `${selected.name} / ${removed.name}`, "Removed an optional assessment section.");
    }
  }

  function addNote(studentId: string, body: string, permission: StudentNotePermission) {
    const student = orfRows.find((row) => row.id === studentId);
    const trimmed = body.trim();
    if (!student || !trimmed) return;
    setNotes((current) => [
      {
        id: `note-${Date.now()}`,
        studentId,
        permission,
        body: trimmed,
        author: permission === "admin_only" ? "Admin" : "Evaluator",
        createdAt: new Date().toISOString().slice(0, 10)
      },
      ...current
    ]);
    recordAudit("Added note", "Student note", student.student, `Added ${permissionLabel(permission)} note for this student.`);
  }

  function editNote(noteId: string, body: string, permission: StudentNotePermission) {
    const existing = notes.find((note) => note.id === noteId);
    const student = existing ? orfRows.find((row) => row.id === existing.studentId) : null;
    setNotes((current) =>
      current.map((note) =>
        note.id === noteId
          ? { ...note, body: body.trim(), permission, createdAt: new Date().toISOString().slice(0, 10) }
          : note
      )
    );
    if (existing && student) {
      recordAudit("Edited note", "Student note", student.student, `Edited note permissions to ${permissionLabel(permission)}.`);
    }
  }

  function deleteNote(noteId: string) {
    const existing = notes.find((note) => note.id === noteId);
    const student = existing ? orfRows.find((row) => row.id === existing.studentId) : null;
    setNotes((current) => current.filter((note) => note.id !== noteId));
    if (existing && student) {
      recordAudit("Deleted note", "Student note", student.student, "Deleted a student note.");
    }
  }

  function addSchoolYear() {
    const lastStart = Math.max(...schoolYears.map((year) => Number(year.slice(0, 4))).filter(Number.isFinite));
    const nextYear = `${lastStart + 1}-${lastStart + 2}`;
    setSchoolYears((current) => [nextYear, ...current]);
    setSelectedOverviewYear(nextYear);
    recordAudit("Created school year", "Overview", nextYear, "Created a new empty school year with no homeroom assignments.");
  }

  function addHomeroomWithStudents(homeroom: string, studentCount: number) {
    const trimmedHomeroom = homeroom.trim();
    if (!trimmedHomeroom || studentCount < 1) return;

    const createdRows = Array.from({ length: studentCount }, (_, index) =>
      hydrateOrfRow({
        id: `student-${Date.now()}-${index + 1}`,
        homeroom: trimmedHomeroom,
        student: `New Student ${activeOverviewRows.length + index + 1}`,
        septP1Wpm: null,
        septP1Epm: null,
        septP2Wpm: null,
        septP2Epm: null,
        septP3Wpm: null,
        septP3Epm: null
      })
    );

    setOrfRows((current) => [...current, ...createdRows]);
    setOverviewPlacements((current) => [
      ...current,
      ...createdRows.map((row) => ({
        studentId: row.id,
        schoolYear: selectedOverviewYear,
        grade: selectedOverviewGrade,
        homeroom: trimmedHomeroom
      }))
    ]);
    setOverviewDialog(null);
    markUnsaved("New students added. Save to add them to Firebase.");
    recordAudit(
      "Added homeroom",
      "Overview",
      `${selectedOverviewYear} / Grade ${selectedOverviewGrade} / ${trimmedHomeroom}`,
      `Added ${studentCount} student placeholder${studentCount === 1 ? "" : "s"} to the homeroom.`
    );
  }

  function moveStudent(studentId: string, homeroom: string) {
    const student = orfRows.find((row) => row.id === studentId);
    const trimmedHomeroom = homeroom.trim();
    if (!student || !trimmedHomeroom) return;

    setOverviewPlacements((current) =>
      current.map((placement) =>
        placement.studentId === studentId &&
        placement.schoolYear === selectedOverviewYear &&
        placement.grade === selectedOverviewGrade
          ? { ...placement, homeroom: trimmedHomeroom }
          : placement
      )
    );
    setOverviewDialog(null);
    markUnsaved("Student moved. Save to keep the table changes.");
    recordAudit("Moved student", "Overview placement", student.student, `Moved student to ${trimmedHomeroom}.`);
  }

  function removeStudentFromHomeroom(studentId: string) {
    const student = orfRows.find((row) => row.id === studentId);
    setOverviewPlacements((current) =>
      current.filter(
        (placement) =>
          !(
            placement.studentId === studentId &&
            placement.schoolYear === selectedOverviewYear &&
            placement.grade === selectedOverviewGrade
          )
      )
    );
    setOverviewDialog(null);
    markUnsaved("Student removed from this homeroom. Save to keep the table changes.");
    if (student) {
      recordAudit(
        "Removed from homeroom",
        "Overview placement",
        student.student,
        "Removed student from the current homeroom while preserving assessment data."
      );
    }
  }

  function recordAudit(eventType: string, entityType: string, entityLabel: string, description: string) {
    const createdAt = new Date().toISOString();
    setAuditEvents((current) => [
      {
        id: `audit-${Date.now()}-${current.length + 1}`,
        eventType,
        entityType,
        entityLabel,
        description,
        createdAt,
        actor: "VP workspace"
      },
      ...current
    ]);
  }

  if (!authReady) {
    return (
      <main className="auth-shell">
        <section className="auth-card panel">
          <p className="eyebrow">Student Evaluations</p>
          <h1>Loading workspace</h1>
          <p>Checking your sign-in status.</p>
        </section>
      </main>
    );
  }

  if (!authUser) {
    return <AuthScreen />;
  }

  if (organizationAccess === "uninvited") {
    return <PendingInviteScreen email={authUser.email ?? ""} onSignOut={() => signOut(getAuth(firebaseApp))} />;
  }

  const builderScrollMode = activeView === "assessment" && assessmentPageTab === "builder";

  return (
    <main className={builderScrollMode ? "app-shell builder-scroll-mode" : "app-shell"}>
      <aside className="sidebar">
        <div className="brand-block">
          <span>Student Evaluations</span>
          <strong>Console</strong>
        </div>

        <nav className="workspace-nav" aria-label="Student Evaluation views">
          {(isAdmin
            ? [
            ["overview", "Overview"],
            ["dashboard", "Dashboard"],
            ["report", "Student Report"],
                ["files", "Report Files"]
              ]
            : [["dashboard", "Dashboard"]]
          ).map(([view, label]) => (
            <button
              className={activeView === view ? "workspace-link active" : "workspace-link"}
              key={view}
              onClick={() => changeActiveView(view as AppView)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>

        <p className="sidebar-label">Assessments</p>
        {isAdmin ? (
          <button className="new-button assessment-new-button" onClick={addCustomAssessment} type="button">
            + New assessment
          </button>
        ) : null}
        <nav className="assessment-nav" aria-label="Assessment definitions">
          {templates.map((template) => (
            <button
              className={activeView === "assessment" && selected.id === template.id ? "assessment-link active" : "assessment-link"}
              key={template.id}
              onClick={() => {
                if (!confirmUnsavedChanges()) return;
                setSelectedId(template.id);
                setActiveView("assessment");
                setAssessmentPageTab("entry");
              }}
              type="button"
            >
              <span>{template.category}</span>
              {template.name}
            </button>
          ))}
        </nav>

        <button className="profile-button" onClick={() => changeActiveView("profile")} type="button">
          <span className="avatar-circle">{initialsFor(userProfile.name || authUser.email || "User")}</span>
          <span>
            <strong>{userProfile.name || "Profile"}</strong>
            <small>{currentUserRole}</small>
          </span>
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{currentUserRole} Workspace</p>
            <h1>{viewTitle(activeView, selected.name)}</h1>
          </div>
          <div className="user-menu">
            <span>{authUser.email}</span>
            <button className="small-action ghost" onClick={() => signOut(getAuth(firebaseApp))} type="button">
              Sign out
            </button>
          </div>
        </header>

        {activeView === "assessment" ? (
          <section className="assessment-workspace">
            <div className="view-tabs assessment-page-tabs" aria-label={`${selected.name} workspace`}>
              <button
                className={assessmentPageTab === "builder" ? "view-tab active" : "view-tab"}
                onClick={() => changeAssessmentTab("builder")}
                type="button"
                disabled={!isAdmin}
              >
                Assessment Builder
              </button>
              <button
                className={assessmentPageTab === "entry" ? "view-tab active" : "view-tab"}
                onClick={() => changeAssessmentTab("entry")}
                type="button"
              >
                Table
              </button>
            </div>

            {assessmentPageTab === "builder" ? (
              <AssessmentBuilder
                selected={selected}
                lockedFieldCount={lockedFieldCount}
                draftField={draftField}
                setDraftField={setDraftField}
                updateSelected={updateSelected}
                addField={addField}
                removeField={removeField}
                addRound={addRound}
                updateRound={updateRound}
                removeRound={removeRound}
                addSection={addSection}
                updateSection={updateSection}
                removeSection={removeSection}
                saveStatus={saveStatus}
                saveMessage={saveMessage}
                onSave={saveTablesToFirebase}
              />
            ) : (
              <InlineEntryTable
                rows={activeOverviewRows}
                setRows={setOrfRows}
                selected={selected}
                notes={notes}
                schoolYears={schoolYears}
                selectedYear={selectedOverviewYear}
                selectedGrade={selectedOverviewGrade}
                onYearChange={setSelectedOverviewYear}
                onGradeChange={setSelectedOverviewGrade}
                openNotes={setActiveNoteStudentId}
                recordAudit={recordAudit}
                saveStatus={saveStatus}
                saveMessage={saveMessage}
                onSave={saveTablesToFirebase}
                markUnsaved={markUnsaved}
              />
            )}
          </section>
        ) : activeView === "overview" ? (
          <VpOverview
            rows={activeOverviewRows}
            templates={templates}
            notes={notes}
            schoolYears={schoolYears}
            selectedYear={selectedOverviewYear}
            selectedGrade={selectedOverviewGrade}
            homerooms={overviewHomerooms}
            locked={lockedOverviewYears.includes(selectedOverviewYear)}
            onYearChange={setSelectedOverviewYear}
            onGradeChange={setSelectedOverviewGrade}
            onAddYear={addSchoolYear}
            onOpenAdd={() => setOverviewDialog({ type: "add" })}
            onMoveStudent={(studentId) => setOverviewDialog({ type: "move", studentId })}
            onDeleteStudent={(studentId) => setOverviewDialog({ type: "delete", studentId })}
            duplicateConflicts={overviewDuplicateConflicts}
            studentNameSuggestions={databaseStudentNames}
            onStudentNameChange={(studentId, studentName) => {
              setOrfRows((current) =>
                current.map((row) => (row.id === studentId ? { ...row, student: studentName } : row))
              );
              setOverviewDuplicateConflicts((current) => current.filter((conflict) => conflict.studentId !== studentId));
              markUnsaved("Student name changed. Save to update Firebase.");
              recordAudit("Edited student name", "Student", studentId, `Changed student display name to ${studentName}.`);
            }}
            openNotes={setActiveNoteStudentId}
            saveStatus={saveStatus}
            saveMessage={saveMessage}
            onSave={saveTablesToFirebase}
            onLockChange={(locked) => {
              setLockedOverviewYears((current) =>
                locked
                  ? Array.from(new Set([...current, selectedOverviewYear]))
                  : current.filter((year) => year !== selectedOverviewYear)
              );
              markUnsaved(
                locked
                  ? `${selectedOverviewYear} is locked. Save to update Firebase.`
                  : `${selectedOverviewYear} is unlocked. Save to update Firebase.`
              );
              recordAudit(
                locked ? "Locked year" : "Unlocked year",
                "Overview lock",
                selectedOverviewYear,
                locked ? "Locked Overview edits for this school year." : "Unlocked Overview edits for this school year."
              );
            }}
          />
        ) : activeView === "dashboard" ? (
          <Dashboard rows={orfRows} templates={templates} />
        ) : activeView === "report" ? (
          <StudentReport rows={orfRows} recordAudit={recordAudit} />
        ) : activeView === "files" ? (
          <ReportFiles rows={orfRows} reports={uploadedReports} setReports={setUploadedReports} recordAudit={recordAudit} />
        ) : activeView === "profile" ? (
          <ProfilePage
            isAdmin={isAdmin}
            activeTab={profilePageTab}
            setActiveTab={setProfilePageTab}
            profile={userProfile}
            setProfile={setUserProfile}
            currentRole={currentUserRole}
            setCurrentRole={setCurrentUserRole}
            teamMembers={teamMembers}
            setTeamMembers={setTeamMembers}
            events={auditEvents}
            openInvite={() => setInviteDialogOpen(true)}
            markUnsaved={markUnsaved}
            saveStatus={saveStatus}
            saveMessage={saveMessage}
            onSave={saveTablesToFirebase}
          />
        ) : (
          <Dashboard rows={orfRows} templates={templates} />
        )}
      </section>

      {activeNoteStudent ? (
        <StudentNotesModal
          student={activeNoteStudent}
          notes={notes.filter((note) => note.studentId === activeNoteStudent.id)}
          onClose={() => setActiveNoteStudentId(null)}
          addNote={addNote}
          editNote={editNote}
          deleteNote={deleteNote}
        />
      ) : null}

      {overviewDialog?.type === "add" ? (
        <AddHomeroomModal
          selectedYear={selectedOverviewYear}
          selectedGrade={selectedOverviewGrade}
          onClose={() => setOverviewDialog(null)}
          onAdd={addHomeroomWithStudents}
        />
      ) : null}

      {overviewDialog?.type === "move" ? (
        <MoveStudentModal
          student={orfRows.find((row) => row.id === overviewDialog.studentId) ?? null}
          homerooms={overviewHomerooms}
          onClose={() => setOverviewDialog(null)}
          onMove={(homeroom) => moveStudent(overviewDialog.studentId, homeroom)}
        />
      ) : null}

      {overviewDialog?.type === "delete" ? (
        <DeleteStudentPlacementModal
          student={orfRows.find((row) => row.id === overviewDialog.studentId) ?? null}
          onClose={() => setOverviewDialog(null)}
          onDelete={() => removeStudentFromHomeroom(overviewDialog.studentId)}
        />
      ) : null}

      {inviteDialogOpen ? (
        <InviteModal
          onClose={() => setInviteDialogOpen(false)}
          onInvite={(emails) => {
            setTeamMembers((current) => [
              ...current,
              ...emails.map((email) => ({
                id: `invite-${Date.now()}-${email}`,
                name: email.split("@")[0],
                email,
                role: "Evaluator" as const,
                grade: "",
                homeroom: "",
                status: "invited" as const
              }))
            ]);
            markUnsaved("Team invites changed. Save to update Firebase.");
            recordAudit("Invited team members", "Team", "Invite list", `Queued ${emails.length} invite${emails.length === 1 ? "" : "s"}.`);
            setInviteDialogOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}

type StudentNote = {
  id: string;
  studentId: string;
  permission: StudentNotePermission;
  body: string;
  author: string;
  createdAt: string;
};

type StudentPlacement = {
  studentId: string;
  schoolYear: string;
  grade: string;
  homeroom: string;
};

type DuplicateStudentNameConflict = {
  studentId: string;
  name: string;
  existingGrade: string;
  existingHomeroom: string;
};

type WorkspaceStudentSnapshot = {
  rows: OrfResultRow[];
  placements: StudentPlacement[];
};

type SavedWorkspaceState = WorkspaceStudentSnapshot & {
  templates: AssessmentTemplate[];
  schoolYears: string[];
  lockedOverviewYears?: string[];
  currentUserRole?: UserRole;
  userProfile?: {
    name: string;
    email: string;
    grade: string;
    homeroom: string;
  };
  teamMembers?: TeamMember[];
};

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  grade: string;
  homeroom: string;
  status: "invited" | "active";
};

type UploadedReport = {
  id: string;
  studentId: string;
  assessment: string;
  round: string;
  fileName: string;
  fileSize: number;
  storagePath: string;
};

type AppAuditEvent = {
  id: string;
  eventType: string;
  entityType: string;
  entityLabel: string;
  description: string;
  createdAt: string;
  actor: string;
};

type EntryRow = OrfResultRow & Record<string, string | number | null>;

function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setAuthMessage("");

    try {
      const auth = getAuth(firebaseApp);
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (displayName.trim()) {
          await updateProfile(credential.user, { displayName: displayName.trim() });
        }
      }
    } catch (error) {
      setAuthMessage(friendlyAuthError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel">
        <div>
          <p className="eyebrow">Student Evaluations</p>
          <h1>{mode === "signin" ? "Sign in" : "Create account"}</h1>
          <p>Use your school workspace account to open the assessment tables and save changes to Firebase.</p>
        </div>

        <form className="auth-form" onSubmit={submitAuth}>
          {mode === "signup" ? (
            <label>
              Name
              <input
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Example: Lindsey Bingley"
              />
            </label>
          ) : null}

          <label>
            Email
            <input
              autoComplete="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@school.ca"
            />
          </label>

          <label>
            Password
            <input
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={6}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
            />
          </label>

          {authMessage ? <div className="auth-message">{authMessage}</div> : null}

          <button className="primary-action" disabled={submitting} type="submit">
            {submitting ? "Working..." : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <button
          className="auth-switch"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setAuthMessage("");
          }}
          type="button"
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}

function PendingInviteScreen({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <main className="auth-shell">
      <section className="auth-card unauthorized-card panel">
        <span className="avatar-circle unauthorized-avatar">{initialsFor(email || "User")}</span>
        <p className="eyebrow">Organization Access</p>
        <h1>Unauthorized</h1>
        <p>
          You will be authorized when an admin has invited you to their organization.
        </p>
        <p className="pending-email">{email}</p>
        <button className="primary-action" onClick={onSignOut} type="button">
          Sign out
        </button>
      </section>
    </main>
  );
}

function activateSignedInMember(members: TeamMember[], user: User) {
  const email = user.email?.toLowerCase() ?? "";
  if (!email) return { members, access: "uninvited" as const, role: null };
  if (!members.length) return { members, access: "active" as const, role: "Vice Principal" as UserRole };

  const matchingMember = members.find((member) => member.email.toLowerCase() === email);
  if (!matchingMember) return { members, access: "uninvited" as const, role: null };

  return {
    members: members.map((member) =>
      member.id === matchingMember.id
        ? {
            ...member,
            id: user.uid,
            name: member.name || user.displayName || email.split("@")[0],
            status: "active" as const
          }
        : member
    ),
    access: "active" as const,
    role: matchingMember.role
  };
}

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("auth/invalid-credential")) return "That email and password did not match an account.";
  if (message.includes("auth/email-already-in-use")) return "That email already has an account. Try signing in.";
  if (message.includes("auth/weak-password")) return "Use a password with at least 6 characters.";
  if (message.includes("auth/operation-not-allowed")) return "Email/password sign-in is not enabled in Firebase yet.";
  return message || "Something went wrong with sign-in.";
}

function AssessmentBuilder({
  selected,
  lockedFieldCount,
  draftField,
  setDraftField,
  updateSelected,
  addField,
  removeField,
  addRound,
  updateRound,
  removeRound,
  addSection,
  updateSection,
  removeSection,
  saveStatus,
  saveMessage,
  onSave
}: {
  selected: AssessmentTemplate;
  lockedFieldCount: number;
  draftField: {
    name: string;
    dataType: AssessmentDataType;
    isCalculated: boolean;
    calculationKey: string;
    calculationExpression: string;
    conditionLeft: string;
    conditionOperator: string;
    conditionRight: string;
    conditionJoinOperator: string;
    conditionExtra: string;
    letterRanks: string;
    selectedRoundIds: string[];
    selectedSectionIds: string[];
  };
  setDraftField: React.Dispatch<
    React.SetStateAction<{
      name: string;
      dataType: AssessmentDataType;
      isCalculated: boolean;
      calculationKey: string;
      calculationExpression: string;
      conditionLeft: string;
      conditionOperator: string;
      conditionRight: string;
      conditionJoinOperator: string;
      conditionExtra: string;
      letterRanks: string;
      selectedRoundIds: string[];
      selectedSectionIds: string[];
    }>
  >;
  updateSelected: (patch: Partial<AssessmentTemplate>) => void;
  addField: () => void;
  removeField: (fieldId: string) => void;
  addRound: () => void;
  updateRound: (roundId: string, patch: Partial<AssessmentRoundTemplate>) => void;
  removeRound: (roundId: string) => void;
  addSection: () => void;
  updateSection: (sectionId: string, patch: Partial<AssessmentSectionTemplate>) => void;
  removeSection: (sectionId: string) => void;
  saveStatus: SaveStatus;
  saveMessage: string;
  onSave: () => Promise<void>;
}) {
  const [colorPickerRoundId, setColorPickerRoundId] = useState<string | null>(null);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [sectionWindowPickerId, setSectionWindowPickerId] = useState<string | null>(null);
  const colorPickerRound = colorPickerRoundId
    ? selected.rounds.find((round) => round.id === colorPickerRoundId) ?? null
    : null;
  const editingField = editingFieldId ? selected.fields.find((field) => field.id === editingFieldId) ?? null : null;
  const sectionWindowPicker = sectionWindowPickerId
    ? (selected.sections ?? []).find((section) => section.id === sectionWindowPickerId) ?? null
    : null;

  function openAddField() {
    setDraftField((field) => ({ ...field, selectedRoundIds: [], selectedSectionIds: [] }));
    setEditingFieldId(null);
    setAddFieldOpen(true);
  }

  function openEditField(field: AssessmentFieldTemplate) {
    setDraftField({
      name: field.name,
      dataType: field.dataType === "calculated" ? "integer" : field.dataType,
      isCalculated: field.isCalculated,
      calculationKey: field.calculationKey ?? "custom",
      calculationExpression: field.calculationExpression ?? "",
      conditionLeft: "median",
      conditionOperator: "<",
      conditionRight: "50",
      conditionJoinOperator: "",
      conditionExtra: "",
      letterRanks: field.letterRanks ?? "",
      selectedRoundIds: field.roundIds ?? [],
      selectedSectionIds: field.sectionIds ?? []
    });
    setEditingFieldId(field.id);
    setAddFieldOpen(true);
  }

  function saveEditedField() {
    const name = draftField.name.trim();
    if (!editingField || !name) return;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    updateSelected({
      fields: selected.fields.map((field) =>
        field.id === editingField.id
          ? {
              ...field,
              name,
              slug,
              dataType: draftField.isCalculated ? "calculated" : draftField.dataType,
              isCalculated: draftField.isCalculated,
              calculationKey: draftField.isCalculated ? draftField.calculationKey : undefined,
              calculationExpression: draftField.isCalculated ? draftField.calculationExpression : undefined,
              letterRanks: draftField.dataType === "letter" ? draftField.letterRanks : undefined,
              roundIds: draftField.selectedRoundIds.length ? draftField.selectedRoundIds : undefined,
              sectionIds: draftField.selectedSectionIds.length ? draftField.selectedSectionIds : undefined
            }
          : field
      )
    });
    setEditingFieldId(null);
    setAddFieldOpen(false);
  }

  return (
    <section className="editor-grid">
      <div className="panel builder-save-panel">
        <div className="panel-heading">
          <p className="eyebrow">Save</p>
          <h2>Assessment Builder changes</h2>
          <p>Save assessment names, windows, colors, fields, formulas, and starter data to Firebase.</p>
        </div>
        <SaveBar status={saveStatus} message={saveMessage} onSave={onSave} compact />
      </div>

      <div className="panel details-panel">
        <div className="panel-heading">
          <p className="eyebrow">Definition</p>
          <h2>{selected.name}</h2>
        </div>

        <label>
          Assessment name
          <input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} />
        </label>

        <label>
          Grade scope
          <input value={selected.gradeScope} onChange={(event) => updateSelected({ gradeScope: event.target.value })} />
        </label>

        <label>
          Description
          <textarea
            rows={5}
            value={selected.description}
            onChange={(event) => updateSelected({ description: event.target.value })}
          />
        </label>
      </div>

      <div className="panel rounds-panel">
        <div className="panel-heading with-action">
          <div>
            <p className="eyebrow">Rounds</p>
            <h2>Assessment windows</h2>
          </div>
          <button className="small-action" onClick={addRound} type="button">
            Add round
          </button>
        </div>
        <div className="round-list">
          {selected.rounds.map((round) => (
            <div className="round-card editable-round" key={round.id}>
              <label>
                Round title
                <input value={round.label} onChange={(event) => updateRound(round.id, { label: event.target.value })} />
              </label>
              <label>
                Month
                <input value={round.month} onChange={(event) => updateRound(round.id, { month: event.target.value })} />
              </label>
              <button
                className="selected-color-button"
                onClick={() => setColorPickerRoundId(round.id)}
                style={{ backgroundColor: round.color ?? pastelRoundColors[0] }}
                type="button"
                aria-label={`Choose color for ${round.label}`}
              >
                <span>Color</span>
              </button>
              <button
                className="builder-icon-button"
                onClick={() => removeRound(round.id)}
                type="button"
                disabled={selected.rounds.length === 1}
                aria-label={`Delete ${round.label}`}
                title="Delete round"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {colorPickerRound ? (
          <div className="color-popover-backdrop" role="dialog" aria-modal="true" aria-label={`${colorPickerRound.label} color picker`}>
            <div className="color-popover panel">
              <div className="modal-top">
                <div>
                  <p className="eyebrow">Window Color</p>
                  <h2>{colorPickerRound.label}</h2>
                </div>
                <button className="small-action ghost" onClick={() => setColorPickerRoundId(null)} type="button">
                  Close
                </button>
              </div>
              <div className="round-color-picker" aria-label={`${colorPickerRound.label} color`}>
                {pastelRoundColors.map((color) => (
                  <button
                    className={colorPickerRound.color === color ? "color-swatch active" : "color-swatch"}
                    key={color}
                    onClick={() => {
                      updateRound(colorPickerRound.id, { color });
                      setColorPickerRoundId(null);
                    }}
                    style={{ backgroundColor: color }}
                    title={color}
                    type="button"
                  >
                    <span>{colorPickerRound.color === color ? "Selected" : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="panel fields-panel">
        <div className="panel-heading with-action">
          <div>
            <p className="eyebrow">Fields</p>
            <h2>Data types and formulas</h2>
            <p>{lockedFieldCount} field{lockedFieldCount === 1 ? "" : "s"} are formula-owned and locked in entry tables.</p>
          </div>
          <button className="small-action" onClick={openAddField} type="button">
            Add Field
          </button>
        </div>

        <div className="field-list">
          {selected.fields.map((field) => (
            <article className="field-row" key={field.id}>
              <div className="field-row-main">
                <strong>{field.name}</strong>
                <p>
                  <span>Windows: {fieldWindowSummary(selected, field)}</span>
                  <span>Sections: {fieldSectionSummary(selected, field)}</span>
                </p>
              </div>
              <div className="field-row-tools">
                <span className={`data-pill ${field.dataType}`}>{field.dataType}</span>
                {field.isCalculated ? <span className="formula-pill">{field.calculationKey}</span> : null}
                <div className="field-row-actions">
                  <button onClick={() => openEditField(field)} type="button" aria-label={`Edit ${field.name}`} title="Edit field">
                    ✎
                  </button>
                  <button onClick={() => removeField(field.id)} type="button" aria-label={`Remove ${field.name}`} title="Delete field">
                    ×
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="panel sections-panel">
        <div className="panel-heading with-action">
          <div>
            <p className="eyebrow">Sections</p>
            <h2>Optional window sections</h2>
          </div>
          <button className="small-action" onClick={addSection} type="button">
            Add section
          </button>
        </div>
        <div className="section-list">
          {(selected.sections ?? []).length ? (
            (selected.sections ?? []).map((section) => (
              <article className="section-card" key={section.id}>
                <label>
                  Section name
                  <input value={section.name} onChange={(event) => updateSection(section.id, { name: event.target.value })} />
                </label>
                <label>
                  Windows
                  <button className="picker-field-button" onClick={() => setSectionWindowPickerId(section.id)} type="button">
                    <span>{labelsForIds(selected.rounds, section.roundIds)}</span>
                    <span className="dropdown-arrow" aria-hidden="true" />
                  </button>
                </label>
                <button
                  className="builder-icon-button"
                  onClick={() => removeSection(section.id)}
                  type="button"
                  aria-label={`Remove ${section.name}`}
                  title="Remove section"
                >
                  ×
                </button>
              </article>
            ))
          ) : (
            <div className="empty-state">No sections yet. Fields can still live directly inside an assessment window.</div>
          )}
        </div>
      </div>

      {addFieldOpen ? (
        <AddFieldModal
          selected={selected}
          draftField={draftField}
          setDraftField={setDraftField}
          submitLabel={editingField ? "Save field" : "Add field"}
          addField={editingField ? saveEditedField : () => {
            addField();
            setAddFieldOpen(false);
          }}
          onClose={() => {
            setAddFieldOpen(false);
            setEditingFieldId(null);
          }}
        />
      ) : null}

      {sectionWindowPicker ? (
        <CheckboxPickerModal
          title={`${sectionWindowPicker.name} windows`}
          items={selected.rounds.map((round) => ({ id: round.id, label: round.label }))}
          selectedIds={sectionWindowPicker.roundIds}
          onChange={(ids) => updateSection(sectionWindowPicker.id, { roundIds: ids })}
          onClose={() => setSectionWindowPickerId(null)}
        />
      ) : null}
    </section>
  );
}

function AddFieldModal({
  selected,
  draftField,
  setDraftField,
  addField,
  submitLabel,
  onClose
}: {
  selected: AssessmentTemplate;
  draftField: {
    name: string;
    dataType: AssessmentDataType;
    isCalculated: boolean;
    calculationKey: string;
    calculationExpression: string;
    conditionLeft: string;
    conditionOperator: string;
    conditionRight: string;
    conditionJoinOperator: string;
    conditionExtra: string;
    letterRanks: string;
    selectedRoundIds: string[];
    selectedSectionIds: string[];
  };
  setDraftField: React.Dispatch<React.SetStateAction<typeof draftField>>;
  addField: () => void;
  submitLabel: string;
  onClose: () => void;
}) {
  const [picker, setPicker] = useState<"windows" | "sections" | null>(null);
  const selectableSections = (selected.sections ?? []).filter(
    (section) => !draftField.selectedRoundIds.length || section.roundIds.some((roundId) => draftField.selectedRoundIds.includes(roundId))
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add assessment field">
      <section className="notes-modal panel add-field-modal">
        <div className="modal-top">
          <div>
            <p className="eyebrow">Add Field</p>
            <h2>Custom score column</h2>
          </div>
          <button className="small-action ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="panel-heading">
          <p className="eyebrow">Definition</p>
        </div>

        <label>
          Field name
          <input
            placeholder="Example: Maze score"
            value={draftField.name}
            onChange={(event) => setDraftField((field) => ({ ...field, name: event.target.value }))}
          />
        </label>

        <label>
          Data type
          <select
            value={draftField.dataType}
            onChange={(event) =>
              setDraftField((field) => ({ ...field, dataType: event.target.value as AssessmentDataType }))
            }
            disabled={draftField.isCalculated}
          >
            {dataTypes.filter((type) => type !== "calculated").map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <PickerField
          label="Window"
          value={draftField.selectedRoundIds.length ? labelsForIds(selected.rounds, draftField.selectedRoundIds) : "All windows"}
          onChoose={() => setPicker("windows")}
        />

        <PickerField
          label="Section"
          value={draftField.selectedSectionIds.length ? labelsForIds(selectableSections, draftField.selectedSectionIds) : "No sections"}
          onChoose={() => setPicker("sections")}
          disabled={!draftField.selectedRoundIds.length}
        />

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draftField.isCalculated}
            onChange={(event) => setDraftField((field) => ({ ...field, isCalculated: event.target.checked }))}
          />
          Calculated
        </label>

        {draftField.isCalculated ? (
          <div className="calculation-builder">
            <label>
              Calculation key
              <select
                value={draftField.calculationKey}
                onChange={(event) => setDraftField((field) => ({ ...field, calculationKey: event.target.value }))}
              >
                {savedCalculations.map((calculation) => (
                  <option key={calculation} value={calculation}>
                    {calculation === "custom" ? "Custom calculation" : calculation}
                  </option>
                ))}
              </select>
            </label>

            {draftField.calculationKey === "custom" ? (
              <label>
                Custom calculation
                <input
                  placeholder="Example: MEDIAN(fall_wpm, winter_wpm)"
                  value={draftField.calculationExpression}
                  onChange={(event) =>
                    setDraftField((field) => ({ ...field, calculationExpression: event.target.value }))
                  }
                />
              </label>
            ) : null}

            <div className="condition-grid">
              <label>
                If
                <input
                  value={draftField.conditionLeft}
                  onChange={(event) => setDraftField((field) => ({ ...field, conditionLeft: event.target.value }))}
                />
              </label>
              <label>
                Operator
                <select
                  value={draftField.conditionOperator}
                  onChange={(event) =>
                    setDraftField((field) => ({ ...field, conditionOperator: event.target.value }))
                  }
                >
                  {conditionOperators.map((operator) => (
                    <option key={operator} value={operator}>
                      {operator}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Value / field
                <input
                  value={draftField.conditionRight}
                  onChange={(event) => setDraftField((field) => ({ ...field, conditionRight: event.target.value }))}
                />
              </label>
              <label>
                Optional operator
                <select
                  value={draftField.conditionJoinOperator}
                  onChange={(event) =>
                    setDraftField((field) => ({ ...field, conditionJoinOperator: event.target.value }))
                  }
                >
                  <option value="">None</option>
                  {conditionOperators.map((operator) => (
                    <option key={operator} value={operator}>
                      {operator}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Optional field
                <input
                  value={draftField.conditionExtra}
                  onChange={(event) => setDraftField((field) => ({ ...field, conditionExtra: event.target.value }))}
                />
              </label>
            </div>

            <button className="small-action condition-save" onClick={() => validateCondition(draftField)} type="button">
              Save condition
            </button>
          </div>
        ) : null}

        {draftField.dataType === "letter" && !draftField.isCalculated ? (
          <label>
            Letter Ranks
            <input
              placeholder="Example: A, B, C, D"
              value={draftField.letterRanks}
              onChange={(event) => setDraftField((field) => ({ ...field, letterRanks: event.target.value }))}
            />
          </label>
        ) : null}

        <button className="primary-action" onClick={addField} type="button">
          {submitLabel}
        </button>

        {picker ? (
          <CheckboxPickerModal
            title={picker === "windows" ? "Choose windows" : "Choose sections"}
            items={(picker === "windows" ? selected.rounds : selectableSections).map((item) => ({ id: item.id, label: "label" in item ? item.label : item.name }))}
            selectedIds={picker === "windows" ? draftField.selectedRoundIds : draftField.selectedSectionIds}
            onChange={(ids) =>
              setDraftField((field) =>
                picker === "windows"
                  ? { ...field, selectedRoundIds: ids, selectedSectionIds: field.selectedSectionIds.filter((sectionId) => selectableSections.some((section) => section.id === sectionId)) }
                  : { ...field, selectedSectionIds: ids }
              )
            }
            onClose={() => setPicker(null)}
          />
        ) : null}
      </section>
    </div>
  );
}

function PickerField({
  label,
  value,
  disabled = false,
  onChoose
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChoose: () => void;
}) {
  return (
    <label>
      {label}
      <div className="picker-field">
        <input readOnly value={value} placeholder={disabled ? "Choose a window first" : "None selected"} />
        <button className="small-action" disabled={disabled} onClick={onChoose} type="button">
          Choose
        </button>
      </div>
    </label>
  );
}

function CheckboxPickerModal({
  title,
  items,
  selectedIds,
  onChange,
  onClose
}: {
  title: string;
  items: Array<{ id: string; label: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }
  const allSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));

  return (
    <div className="modal-backdrop nested-modal" role="dialog" aria-modal="true" aria-label={title}>
      <section className="notes-modal panel picker-modal">
        <div className="modal-top">
          <h2>{title}</h2>
          <button className="small-action ghost" onClick={onClose} type="button">
            Done
          </button>
        </div>
        <button className="small-action ghost" onClick={() => onChange(allSelected ? [] : items.map((item) => item.id))} type="button">
          {allSelected ? "Clear all" : "Select all"}
        </button>
        <div className="option-checks">
          {items.map((item) => (
            <label className="checkbox-row" key={item.id}>
              <input checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} type="checkbox" />
              {item.label}
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

function InlineEntryTable({
  rows,
  setRows,
  selected,
  notes,
  schoolYears,
  selectedYear,
  selectedGrade,
  onYearChange,
  onGradeChange,
  openNotes,
  recordAudit,
  saveStatus,
  saveMessage,
  onSave,
  markUnsaved
}: {
  rows: OrfResultRow[];
  setRows: React.Dispatch<React.SetStateAction<OrfResultRow[]>>;
  selected: AssessmentTemplate;
  notes: StudentNote[];
  schoolYears: string[];
  selectedYear: string;
  selectedGrade: string;
  onYearChange: (year: string) => void;
  onGradeChange: (grade: string) => void;
  openNotes: (studentId: string) => void;
  recordAudit: RecordAudit;
  saveStatus: SaveStatus;
  saveMessage: string;
  onSave: () => Promise<void>;
  markUnsaved: (message?: string) => void;
}) {
  const rowData = useMemo(() => buildEntryRows(rows, selected), [rows, selected]);
  const columnDefs = useMemo<ColDef<EntryRow>[]>(
    () => [
      { field: "homeroom", headerName: "HR", pinned: "left", width: 90, filter: true },
      { field: "student", headerName: "Student", pinned: "left", width: 130, filter: true },
      noteColumn(notes, openNotes),
      ...selected.rounds.map((round) => ({
        headerName: round.label,
        headerStyle: roundHeaderStyle(round),
        children: columnsForRound(selected, round)
      }))
    ],
    [notes, openNotes, selected]
  );

  function onCellValueChanged(event: CellValueChangedEvent<EntryRow>) {
    if (!event.data || event.oldValue === event.newValue || !event.colDef.field) return;
    recordAudit(
      "Edited score",
      "Assessment result",
      `${event.data.student} / ${event.colDef.headerName ?? event.colDef.field}`,
      `Changed ${event.colDef.field} from ${event.oldValue ?? "-"} to ${event.newValue ?? "-"}.`
    );
    markUnsaved("Assessment table changed. Save to keep the table changes.");

    if (selected.id !== "orf") return;
    const fieldName = event.colDef.field;
    setRows((current) =>
      current.map((row) =>
        row.id === event.data?.id
          ? hydrateOrfRow({
              id: row.id,
              homeroom: row.homeroom,
              student: row.student,
              septP1Wpm: fieldName === "fall_wpm" ? toNumber(event.newValue) : row.septP1Wpm,
              septP1Epm: fieldName === "fall_epm" ? toNumber(event.newValue) : row.septP1Epm,
              septP2Wpm: row.septP2Wpm,
              septP2Epm: row.septP2Epm,
              septP3Wpm: row.septP3Wpm,
              septP3Epm: row.septP3Epm
            })
          : row
      )
    );
  }

  return (
    <section className="panel entry-panel">
      <div className="entry-heading">
        <div>
          <p className="eyebrow">Evaluator Entry</p>
          <h2>{selected.name}</h2>
        </div>

        <div className="entry-filters">
          <label>
            Year
            <select value={selectedYear} onChange={(event) => onYearChange(event.target.value)}>
              {schoolYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grade
            <select value={selectedGrade} onChange={(event) => onGradeChange(event.target.value)}>
              {["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].map((grade) => (
                <option key={grade} value={grade}>
                  Grade {grade}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="entry-save-row">
        <SaveBar status={saveStatus} message={saveMessage} onSave={onSave} />
        <div className="entry-status entry-student-count">
          <strong>{rows.length}</strong>
          <span>students assigned</span>
        </div>
      </div>

      <div className="ag-theme-quartz assessment-grid-table entry-grid">
        <AgGridReact<EntryRow>
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{
            resizable: true,
            sortable: true,
            filter: false
          }}
          getRowId={(params) => params.data.id}
          onCellValueChanged={onCellValueChanged}
          suppressColumnVirtualisation
          stopEditingWhenCellsLoseFocus
        />
      </div>
    </section>
  );
}

function SaveBar({
  status,
  message,
  onSave,
  compact = false
}: {
  status: SaveStatus;
  message: string;
  onSave: () => Promise<void>;
  compact?: boolean;
}) {
  return (
    <div className={`save-bar ${status}${compact ? " compact" : ""}`}>
      <button className="primary-action" disabled={status === "saved" || status === "saving"} onClick={onSave} type="button">
        {status === "saving" ? "Saving..." : "Save"}
      </button>
      <span>{message}</span>
    </div>
  );
}

function VpOverview({
  rows,
  templates,
  notes,
  schoolYears,
  selectedYear,
  selectedGrade,
  homerooms,
  locked,
  onYearChange,
  onGradeChange,
  onAddYear,
  onOpenAdd,
  onMoveStudent,
  onDeleteStudent,
  duplicateConflicts,
  studentNameSuggestions,
  onStudentNameChange,
  openNotes,
  saveStatus,
  saveMessage,
  onSave,
  onLockChange
}: {
  rows: OrfResultRow[];
  templates: AssessmentTemplate[];
  notes: StudentNote[];
  schoolYears: string[];
  selectedYear: string;
  selectedGrade: string;
  homerooms: string[];
  locked: boolean;
  onYearChange: (year: string) => void;
  onGradeChange: (grade: string) => void;
  onAddYear: () => void;
  onOpenAdd: () => void;
  onMoveStudent: (studentId: string) => void;
  onDeleteStudent: (studentId: string) => void;
  duplicateConflicts: DuplicateStudentNameConflict[];
  studentNameSuggestions: string[];
  onStudentNameChange: (studentId: string, studentName: string) => void;
  openNotes: (studentId: string) => void;
  saveStatus: SaveStatus;
  saveMessage: string;
  onSave: () => Promise<void>;
  onLockChange: (locked: boolean) => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [hiddenAssessmentIds, setHiddenAssessmentIds] = useState<string[]>([]);
  const [hiddenRoundIds, setHiddenRoundIds] = useState<string[]>([]);
  const [hiddenSectionIds, setHiddenSectionIds] = useState<string[]>([]);
  const [hiddenFieldIds, setHiddenFieldIds] = useState<string[]>([]);
  const duplicateStudentIds = useMemo(() => duplicateConflicts.map((conflict) => conflict.studentId), [duplicateConflicts]);
  const rowData = useMemo(() => buildOverviewRows(rows, templates), [rows, templates]);
  const columnDefs = useMemo<ColDef<EntryRow>[]>(
    () => [
      { field: "homeroom", headerName: "HR", pinned: "left", width: 90, filter: true },
      studentActionColumn(onMoveStudent, onDeleteStudent, onStudentNameChange, locked, duplicateStudentIds, studentNameSuggestions),
      noteColumn(notes, openNotes),
      ...templates
        .filter((template) => !hiddenAssessmentIds.includes(template.id))
        .map((template) => ({
          headerName: template.name,
          children: template.rounds
            .filter((round) => !hiddenRoundIds.includes(round.id))
            .map((round) => ({
              headerName: round.label,
              headerStyle: roundHeaderStyle(round),
              children: columnsForRound(template, round, `${template.id}_${round.id}`, hiddenFieldIds, hiddenSectionIds)
            }))
        }))
    ],
    [
      duplicateStudentIds,
      hiddenAssessmentIds,
      hiddenFieldIds,
      hiddenRoundIds,
      hiddenSectionIds,
      locked,
      notes,
      onDeleteStudent,
      onMoveStudent,
      onStudentNameChange,
      openNotes,
      studentNameSuggestions,
      templates
    ]
  );

  function toggleLock() {
    const nextLocked = !locked;
    const message = nextLocked
      ? `Lock ${selectedYear}? Student names will stop being editable, Move/X actions will be hidden, and adding homerooms will be disabled for this year.`
      : `Unlock ${selectedYear}? Student names will become editable and Move/Add actions will return for this year.`;
    if (window.confirm(message)) {
      onLockChange(nextLocked);
    }
  }

  function onCellValueChanged(event: CellValueChangedEvent<EntryRow>) {
    if (event.colDef.field === "student" && event.data?.id && event.newValue !== event.oldValue) {
      onStudentNameChange(event.data.id, String(event.newValue ?? ""));
    }
  }

  return (
    <section className="overview-panel">
      <div className="panel overview-table-panel">
        <div className="overview-toolbar">
          <label>
            Year
            <select
              value={selectedYear}
              onChange={(event) => {
                if (saveStatus === "dirty" && !window.confirm("You have unsaved table changes. Change years without saving?")) {
                  event.target.value = selectedYear;
                  return;
                }
                onYearChange(event.target.value);
              }}
            >
              {schoolYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <button className="small-action" onClick={onAddYear} type="button">
            Add new year
          </button>

          <label>
            Grade
            <select
              value={selectedGrade}
              onChange={(event) => {
                if (saveStatus === "dirty" && !window.confirm("You have unsaved table changes. Change grades without saving?")) {
                  event.target.value = selectedGrade;
                  return;
                }
                onGradeChange(event.target.value);
              }}
            >
              {["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].map((grade) => (
                <option key={grade} value={grade}>
                  Grade {grade}
                </option>
              ))}
            </select>
          </label>

          <button className="primary-action toolbar-action" disabled={locked} onClick={onOpenAdd} type="button">
            Add homeroom / students
          </button>

          <button className="small-action" onClick={() => setOptionsOpen(true)} type="button">
            Options
          </button>

          <button className={locked ? "small-action muted-action" : "small-action"} onClick={toggleLock} type="button">
            {locked ? "Unlock" : "Lock"}
          </button>
        </div>

        <div className="overview-save-row">
          <SaveBar status={saveStatus} message={saveMessage} onSave={onSave} />
          <div className="entry-status overview-student-count">
            <strong>{rows.length}</strong>
            <span>students assigned</span>
          </div>
        </div>

        <div className={rows.length === 0 ? "empty-state overview-empty" : "overview-empty is-hidden"}>
          No students are assigned to a homeroom for Grade {selectedGrade} in {selectedYear}.
        </div>

        {duplicateConflicts.length ? (
          <div className="overview-duplicate-alert" role="alert">
            <strong>Resolve duplicate student names before saving.</strong>
            <span>
              {duplicateConflicts
                .map((conflict) => `${conflict.name} already exists in Grade ${conflict.existingGrade}, HR ${conflict.existingHomeroom}`)
                .join("; ")}
            </span>
          </div>
        ) : null}

        <div className="ag-theme-quartz assessment-grid-table overview-grid">
          <AgGridReact<EntryRow>
            rowData={rowData}
            columnDefs={columnDefs}
            defaultColDef={{
              editable: true,
              resizable: true,
              sortable: true,
              filter: true
            }}
            getRowId={(params) => params.data.id}
            onCellValueChanged={onCellValueChanged}
            suppressColumnVirtualisation
            stopEditingWhenCellsLoseFocus
          />
        </div>

        <p className="overview-hint">
          Homerooms in this view: {homerooms.length ? homerooms.join(", ") : "none yet"}.
        </p>
      </div>

      {optionsOpen ? (
        <OverviewOptionsModal
          templates={templates}
          hiddenAssessmentIds={hiddenAssessmentIds}
          hiddenRoundIds={hiddenRoundIds}
          hiddenSectionIds={hiddenSectionIds}
          hiddenFieldIds={hiddenFieldIds}
          setHiddenAssessmentIds={setHiddenAssessmentIds}
          setHiddenRoundIds={setHiddenRoundIds}
          setHiddenSectionIds={setHiddenSectionIds}
          setHiddenFieldIds={setHiddenFieldIds}
          onClose={() => setOptionsOpen(false)}
        />
      ) : null}
    </section>
  );
}

function Dashboard({ rows, templates }: { rows: OrfResultRow[]; templates: AssessmentTemplate[] }) {
  const [studentId, setStudentId] = useState("all");
  const [assessmentId, setAssessmentId] = useState("all");
  const [year, setYear] = useState(dashboardYears[0]);

  const filteredRows = useMemo(() => {
    return studentId === "all" ? rows : rows.filter((row) => row.id === studentId);
  }, [rows, studentId]);

  const chartData = useMemo(() => {
    const medians = filteredRows
      .map((row) => row.septMedian)
      .filter((value): value is number => typeof value === "number");
    const baseAverage = medians.length
      ? Math.round((medians.reduce((total, value) => total + value, 0) / medians.length) * 10) / 10
      : 0;
    const assessmentOffset = assessmentId === "all" ? 0 : templates.findIndex((template) => template.id === assessmentId) * 4;
    const yearOffset = dashboardYears.indexOf(year) * -3;

    return [
      { round: "Fall", averageMedian: Math.max(0, baseAverage + assessmentOffset + yearOffset) },
      { round: "Winter", averageMedian: Math.max(0, baseAverage + 8 + assessmentOffset + yearOffset) },
      { round: "Spring", averageMedian: Math.max(0, baseAverage + 14 + assessmentOffset + yearOffset) }
    ];
  }, [assessmentId, filteredRows, templates, year]);

  const homeroomData = useMemo(() => {
    return Array.from(new Set(filteredRows.map((row) => row.homeroom))).map((homeroom) => {
      const homeroomRows = filteredRows.filter((row) => row.homeroom === homeroom);
      return {
        homeroom,
        watch: homeroomRows.filter((row) => typeof row.septMedian === "number" && row.septMedian < 50).length,
        total: homeroomRows.length
      };
    });
  }, [filteredRows]);

  return (
    <section className="dashboard-layout">
      <div className="panel dashboard-hero">
        <p className="eyebrow">Dashboard</p>
        <h2>Assessment Trends</h2>
        <p>Use filters to focus the charts on a student, assessment, and school year.</p>
      </div>

      <div className="panel dashboard-filters">
        <label>
          Student
          <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
            <option value="all">All students</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.student} / {row.homeroom}
              </option>
            ))}
          </select>
        </label>

        <label>
          Assessment
          <select value={assessmentId} onChange={(event) => setAssessmentId(event.target.value)}>
            <option value="all">All assessments</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Year
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            {dashboardYears.map((schoolYear) => (
              <option key={schoolYear} value={schoolYear}>
                {schoolYear}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel chart-panel">
        <div className="panel-heading">
          <p className="eyebrow">Progression</p>
          <h2>Average score by round</h2>
        </div>
        <div className="chart-frame">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="round" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="averageMedian" stroke="#101820" strokeWidth={3} dot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel chart-panel">
        <div className="panel-heading">
          <p className="eyebrow">Watch List</p>
          <h2>Below-50 count by homeroom</h2>
        </div>
        <div className="chart-frame">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={homeroomData} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="homeroom" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="watch" fill="#ff6f61" radius={[6, 6, 0, 0]} />
              <Bar dataKey="total" fill="#d4a72c" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function ProfilePage({
  isAdmin,
  activeTab,
  setActiveTab,
  profile,
  setProfile,
  currentRole,
  setCurrentRole,
  teamMembers,
  setTeamMembers,
  events,
  openInvite,
  markUnsaved,
  saveStatus,
  saveMessage,
  onSave
}: {
  isAdmin: boolean;
  activeTab: ProfilePageTab;
  setActiveTab: (tab: ProfilePageTab) => void;
  profile: { name: string; email: string; grade: string; homeroom: string };
  setProfile: React.Dispatch<React.SetStateAction<{ name: string; email: string; grade: string; homeroom: string }>>;
  currentRole: UserRole;
  setCurrentRole: React.Dispatch<React.SetStateAction<UserRole>>;
  teamMembers: TeamMember[];
  setTeamMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
  events: AppAuditEvent[];
  openInvite: () => void;
  markUnsaved: (message?: string) => void;
  saveStatus: SaveStatus;
  saveMessage: string;
  onSave: () => Promise<void>;
}) {
  const visibleTab = isAdmin ? activeTab : "profile";

  function updateProfileField(field: keyof typeof profile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
    markUnsaved("Profile changed. Save to update Firebase.");
  }

  function updateTeamRole(memberId: string, role: UserRole) {
    setTeamMembers((current) => current.map((member) => (member.id === memberId ? { ...member, role } : member)));
    markUnsaved("Team role changed. Save to update Firebase.");
    const member = teamMembers.find((item) => item.id === memberId);
    if (member?.email === profile.email) setCurrentRole(role);
  }

  return (
    <section className="profile-layout">
      <div className="panel profile-hero">
        <span className="avatar-circle large">{initialsFor(profile.name || profile.email || "User")}</span>
        <div>
          <p className="eyebrow">Profile</p>
          <h2>{profile.name || "Your profile"}</h2>
          <p>{profile.email}</p>
        </div>
      </div>

      <div className="view-tabs profile-tabs" aria-label="Profile sections">
        <button className={visibleTab === "profile" ? "view-tab active" : "view-tab"} onClick={() => setActiveTab("profile")} type="button">
          Profile
        </button>
        {isAdmin ? (
          <>
            <button className={visibleTab === "audit" ? "view-tab active" : "view-tab"} onClick={() => setActiveTab("audit")} type="button">
              Audit Log
            </button>
            <button className={visibleTab === "team" ? "view-tab active" : "view-tab"} onClick={() => setActiveTab("team")} type="button">
              Team
            </button>
          </>
        ) : null}
      </div>

      {visibleTab === "profile" ? (
        <div className="panel profile-form">
          <label>
            User name
            <input value={profile.name} onChange={(event) => updateProfileField("name", event.target.value)} />
          </label>
          <label>
            Email address
            <input value={profile.email} onChange={(event) => updateProfileField("email", event.target.value)} />
          </label>
          <label>
            Grade
            <input value={profile.grade} onChange={(event) => updateProfileField("grade", event.target.value)} />
          </label>
          <label>
            Home room
            <input value={profile.homeroom} onChange={(event) => updateProfileField("homeroom", event.target.value)} />
          </label>
          {isAdmin ? (
            <label>
              Current role
              <select
                value={currentRole}
                onChange={(event) => {
                  setCurrentRole(event.target.value as UserRole);
                  markUnsaved("Role changed. Save to update Firebase.");
                }}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {visibleTab === "audit" ? <AuditLog events={events} /> : null}

      {visibleTab === "team" ? (
        <div className="panel team-panel">
          <SaveBar status={saveStatus} message={saveMessage} onSave={onSave} />
          <div className="panel-heading with-action">
            <div>
              <p className="eyebrow">Team</p>
              <h2>Organization users</h2>
            </div>
            <button className="small-action" onClick={openInvite} type="button">
              Invite
            </button>
          </div>
          <div className="team-table">
            {teamMembers.map((member) => (
              <div className="team-row" key={member.id}>
                <span className="avatar-circle">{initialsFor(member.name || member.email)}</span>
                <div>
                  <strong>{member.name}</strong>
                  <p>{member.email} / {member.status}</p>
                </div>
                <select value={member.role} onChange={(event) => updateTeamRole(member.id, event.target.value as UserRole)}>
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function InviteModal({ onClose, onInvite }: { onClose: () => void; onInvite: (emails: string[]) => void }) {
  const [emails, setEmails] = useState([""]);
  const cleanEmails = emails.map((email) => email.trim()).filter(Boolean);
  const inviteSubject = "You're invited to Student Evaluations";
  const inviteBody = [
    "Hello,",
    "",
    "You have been invited to the Student Evaluations app.",
    "",
    "Please navigate to http://localhost:3020 and create an account using this invited email address.",
    "",
    "After your account is created, your organization access and assigned role will be activated automatically.",
    "",
    "Thank you."
  ].join("\n");

  function sendInvites() {
    const mailto = `mailto:${cleanEmails.join(",")}?subject=${encodeURIComponent(inviteSubject)}&body=${encodeURIComponent(inviteBody)}`;
    window.location.href = mailto;
    onInvite(cleanEmails);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Invite team members">
      <section className="notes-modal panel">
        <div className="modal-top">
          <div>
            <p className="eyebrow">Team</p>
            <h2>Invite users</h2>
          </div>
          <button className="small-action ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="invite-fields">
          {emails.map((email, index) => (
            <label key={index}>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmails((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
              />
            </label>
          ))}
        </div>
        <div className="invite-template">
          <p className="eyebrow">Email Template</p>
          <pre>{inviteBody}</pre>
        </div>
        <div className="modal-actions">
          <button className="small-action ghost" onClick={() => setEmails((current) => [...current, ""])} type="button">
            Add Another Email
          </button>
          <button className="primary-action" disabled={!cleanEmails.length} onClick={sendInvites} type="button">
            Invite
          </button>
        </div>
      </section>
    </div>
  );
}

function StudentReport({ rows, recordAudit }: { rows: OrfResultRow[]; recordAudit: RecordAudit }) {
  const [studentId, setStudentId] = useState(rows[0]?.id ?? "");
  const selectedStudent = rows.find((row) => row.id === studentId) ?? rows[0];

  const reportText = selectedStudent
    ? [
        "Student Assessment Report",
        "",
        `Student: ${selectedStudent.student}`,
        `Homeroom: ${selectedStudent.homeroom}`,
        "Assessment: Oral Reading Fluency",
        "Round: September / Fall",
        "",
        `Passage 1: WPM ${selectedStudent.septP1Wpm ?? "-"}, EPM ${selectedStudent.septP1Epm ?? "-"}, CWPM ${selectedStudent.septP1Cwpm ?? "-"}`,
        `Passage 2: WPM ${selectedStudent.septP2Wpm ?? "-"}, EPM ${selectedStudent.septP2Epm ?? "-"}, CWPM ${selectedStudent.septP2Cwpm ?? "-"}`,
        `Passage 3: WPM ${selectedStudent.septP3Wpm ?? "-"}, EPM ${selectedStudent.septP3Epm ?? "-"}, CWPM ${selectedStudent.septP3Cwpm ?? "-"}`,
        "",
        `Median: ${selectedStudent.septMedian ?? "-"}`,
        `Percentile: ${selectedStudent.septPercentile ?? "-"}`,
        `Status: ${selectedStudent.septMedian !== null && selectedStudent.septMedian < 50 ? "Watch" : "On track"}`
      ].join("\n")
    : "";

  function downloadReport() {
    if (!selectedStudent) return;
    const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedStudent.student}-assessment-report.txt`;
    link.click();
    URL.revokeObjectURL(url);
    recordAudit("Downloaded report", "Student report", selectedStudent.student, "Generated and downloaded an individual assessment summary.");
  }

  return (
    <section className="report-layout">
      <div className="panel report-controls">
        <p className="eyebrow">Student Report</p>
        <h2>Individual assessment summary</h2>
        <p>Generate a student-specific report for sharing assessment context with an Ed Psych team.</p>

        <label>
          Student
          <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.student} / {row.homeroom}
              </option>
            ))}
          </select>
        </label>

        <button className="primary-action" onClick={downloadReport} type="button">
          Download text report
        </button>
      </div>

      <div className="panel report-preview">
        <div className="report-paper">
          <pre>{reportText}</pre>
        </div>
      </div>
    </section>
  );
}

function StudentNotesModal({
  student,
  notes,
  onClose,
  addNote,
  editNote,
  deleteNote
}: {
  student: OrfResultRow;
  notes: StudentNote[];
  onClose: () => void;
  addNote: (studentId: string, body: string, permission: StudentNotePermission) => void;
  editNote: (noteId: string, body: string, permission: StudentNotePermission) => void;
  deleteNote: (noteId: string) => void;
}) {
  const [draftBody, setDraftBody] = useState("");
  const [draftPermission, setDraftPermission] = useState<StudentNotePermission>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingNote = editingId ? notes.find((note) => note.id === editingId) : null;

  function startEdit(note: StudentNote) {
    setEditingId(note.id);
    setDraftBody(note.body);
    setDraftPermission(note.permission);
  }

  function saveNote() {
    if (!draftBody.trim()) return;
    if (editingId) {
      editNote(editingId, draftBody, draftPermission);
    } else {
      addNote(student.id, draftBody, draftPermission);
    }
    setDraftBody("");
    setDraftPermission("all");
    setEditingId(null);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${student.student} notes`}>
      <section className="notes-modal panel">
        <div className="modal-top">
          <div>
            <p className="eyebrow">{student.homeroom}</p>
            <h2>{student.student} notes</h2>
          </div>
          <button className="small-action ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="notes-list">
          {notes.length ? (
            notes.map((note) => (
              <article className="note-card" key={note.id}>
                <div className="note-card-top">
                  <span className={`note-visibility ${note.permission}`}>{permissionLabel(note.permission)}</span>
                  <span>{note.createdAt} / {note.author}</span>
                </div>
                <p>{note.body}</p>
                <div className="note-actions">
                  <button onClick={() => startEdit(note)} type="button">
                    Edit
                  </button>
                  <button onClick={() => deleteNote(note.id)} type="button">
                    Delete
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">No notes yet for this student.</div>
          )}
        </div>

        <div className="note-editor">
          <h3>{editingNote ? "Edit note" : "Add note"}</h3>
          <label>
            Permissions
            <select value={draftPermission} onChange={(event) => setDraftPermission(event.target.value as StudentNotePermission)}>
              <option value="all">All</option>
              <option value="admin_only">Admin only</option>
            </select>
          </label>
          <label>
            Note
            <textarea rows={4} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} />
          </label>
          <button className="primary-action" onClick={saveNote} type="button">
            {editingNote ? "Save note" : "Add note"}
          </button>
        </div>
      </section>
    </div>
  );
}

function AddHomeroomModal({
  selectedYear,
  selectedGrade,
  onClose,
  onAdd
}: {
  selectedYear: string;
  selectedGrade: string;
  onClose: () => void;
  onAdd: (homeroom: string, studentCount: number) => void;
}) {
  const [homeroom, setHomeroom] = useState("");
  const [studentCount, setStudentCount] = useState(1);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add homeroom and students">
      <section className="notes-modal panel">
        <div className="modal-top">
          <div>
            <p className="eyebrow">{selectedYear} / Grade {selectedGrade}</p>
            <h2>Add homeroom and students</h2>
          </div>
          <button className="small-action ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <label>
          Home room
          <input placeholder="Example: 3C" value={homeroom} onChange={(event) => setHomeroom(event.target.value)} />
        </label>

        <label>
          Number of students
          <input
            min={1}
            max={40}
            type="number"
            value={studentCount}
            onChange={(event) => setStudentCount(Math.max(1, Number(event.target.value)))}
          />
        </label>

        <button className="primary-action" onClick={() => onAdd(homeroom, studentCount)} type="button">
          Add
        </button>
      </section>
    </div>
  );
}

function MoveStudentModal({
  student,
  homerooms,
  onClose,
  onMove
}: {
  student: OrfResultRow | null;
  homerooms: string[];
  onClose: () => void;
  onMove: (homeroom: string) => void;
}) {
  const [selectedHomeroom, setSelectedHomeroom] = useState(homerooms[0] ?? "custom");
  const [customHomeroom, setCustomHomeroom] = useState("");
  const targetHomeroom = selectedHomeroom === "custom" ? customHomeroom : selectedHomeroom;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Move student">
      <section className="notes-modal panel">
        <div className="modal-top">
          <div>
            <p className="eyebrow">Move student</p>
            <h2>{student?.student ?? "Student"}</h2>
          </div>
          <button className="small-action ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <label>
          Home room
          <select value={selectedHomeroom} onChange={(event) => setSelectedHomeroom(event.target.value)}>
            {homerooms.map((homeroom) => (
              <option key={homeroom} value={homeroom}>
                {homeroom}
              </option>
            ))}
            <option value="custom">New home room</option>
          </select>
        </label>

        {selectedHomeroom === "custom" ? (
          <label>
            New home room
            <input value={customHomeroom} onChange={(event) => setCustomHomeroom(event.target.value)} />
          </label>
        ) : null}

        <button className="primary-action" onClick={() => onMove(targetHomeroom)} type="button">
          Move
        </button>
      </section>
    </div>
  );
}

function DeleteStudentPlacementModal({
  student,
  onClose,
  onDelete
}: {
  student: OrfResultRow | null;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Remove student from homeroom">
      <section className="notes-modal panel">
        <div className="modal-top">
          <div>
            <p className="eyebrow">Warning</p>
            <h2>Remove {student?.student ?? "student"}?</h2>
          </div>
          <button className="small-action ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <p>
          This removes the student from the current home room only. Their assessment data will be preserved
          and can be used again if they are added to another home room or grade.
        </p>

        <div className="modal-actions">
          <button className="small-action ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="danger-action" onClick={onDelete} type="button">
            Remove from home room
          </button>
        </div>
      </section>
    </div>
  );
}

function OverviewOptionsModal({
  templates,
  hiddenAssessmentIds,
  hiddenRoundIds,
  hiddenSectionIds,
  hiddenFieldIds,
  setHiddenAssessmentIds,
  setHiddenRoundIds,
  setHiddenSectionIds,
  setHiddenFieldIds,
  onClose
}: {
  templates: AssessmentTemplate[];
  hiddenAssessmentIds: string[];
  hiddenRoundIds: string[];
  hiddenSectionIds: string[];
  hiddenFieldIds: string[];
  setHiddenAssessmentIds: React.Dispatch<React.SetStateAction<string[]>>;
  setHiddenRoundIds: React.Dispatch<React.SetStateAction<string[]>>;
  setHiddenSectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  setHiddenFieldIds: React.Dispatch<React.SetStateAction<string[]>>;
  onClose: () => void;
}) {
  const allAssessmentIds = templates.map((template) => template.id);
  const allRoundIds = Array.from(new Set(templates.flatMap((template) => template.rounds.map((round) => round.id))));
  const allSectionIds = Array.from(new Set(templates.flatMap((template) => template.sections?.map((section) => section.id) ?? [])));
  const allFieldIds = Array.from(new Set(templates.flatMap((template) => template.fields.map((field) => field.id))));
  const disabledRoundIds = allRoundIds.filter((roundId) =>
    templates.filter((template) => template.rounds.some((round) => round.id === roundId)).every((template) => hiddenAssessmentIds.includes(template.id))
  );
  const disabledSectionIds = allSectionIds.filter((sectionId) => {
    const owningTemplates = templates.filter((template) => template.sections?.some((section) => section.id === sectionId));
    const section = templates.flatMap((template) => template.sections ?? []).find((item) => item.id === sectionId);
    const sectionWindowsHidden = section
      ? section.roundIds.length > 0 && section.roundIds.every((roundId) => hiddenRoundIds.includes(roundId) || disabledRoundIds.includes(roundId))
      : false;
    return owningTemplates.every((template) => hiddenAssessmentIds.includes(template.id)) || sectionWindowsHidden;
  });
  const disabledFieldIds = allFieldIds.filter((fieldId) => {
    const owningTemplates = templates.filter((template) => template.fields.some((field) => field.id === fieldId));
    const field = templates.flatMap((template) => template.fields).find((item) => item.id === fieldId);
    const fieldWindowsHidden = field?.roundIds
      ? field.roundIds.length > 0 && field.roundIds.every((roundId) => hiddenRoundIds.includes(roundId) || disabledRoundIds.includes(roundId))
      : false;
    const fieldSectionsHidden = field?.sectionIds
      ? field.sectionIds.length > 0 && field.sectionIds.every((sectionId) => hiddenSectionIds.includes(sectionId) || disabledSectionIds.includes(sectionId))
      : false;
    return owningTemplates.every((template) => hiddenAssessmentIds.includes(template.id)) || fieldWindowsHidden || fieldSectionsHidden;
  });

  function applyHiddenAssessments(nextHiddenIds: string[]) {
    setHiddenAssessmentIds(nextHiddenIds);
    const nextDisabledRoundIds = allRoundIds.filter((roundId) =>
      templates.filter((template) => template.rounds.some((round) => round.id === roundId)).every((template) => nextHiddenIds.includes(template.id))
    );
    const nextDisabledSectionIds = allSectionIds.filter((sectionId) => {
      const owningTemplates = templates.filter((template) => template.sections?.some((section) => section.id === sectionId));
      const section = templates.flatMap((template) => template.sections ?? []).find((item) => item.id === sectionId);
      const sectionWindowsHidden = section
        ? section.roundIds.length > 0 && section.roundIds.every((roundId) => hiddenRoundIds.includes(roundId) || nextDisabledRoundIds.includes(roundId))
        : false;
      return owningTemplates.every((template) => nextHiddenIds.includes(template.id)) || sectionWindowsHidden;
    });
    const nextDisabledFieldIds = allFieldIds.filter((fieldId) => {
      const owningTemplates = templates.filter((template) => template.fields.some((field) => field.id === fieldId));
      const field = templates.flatMap((template) => template.fields).find((item) => item.id === fieldId);
      const fieldWindowsHidden = field?.roundIds
        ? field.roundIds.length > 0 && field.roundIds.every((roundId) => hiddenRoundIds.includes(roundId) || nextDisabledRoundIds.includes(roundId))
        : false;
      const fieldSectionsHidden = field?.sectionIds
        ? field.sectionIds.length > 0 && field.sectionIds.every((sectionId) => hiddenSectionIds.includes(sectionId) || nextDisabledSectionIds.includes(sectionId))
        : false;
      return owningTemplates.every((template) => nextHiddenIds.includes(template.id)) || fieldWindowsHidden || fieldSectionsHidden;
    });
    setHiddenRoundIds((current) => uniqueIds([...current.filter((id) => nextDisabledRoundIds.includes(id)), ...nextDisabledRoundIds]));
    setHiddenSectionIds((current) => uniqueIds([...current.filter((id) => nextDisabledSectionIds.includes(id)), ...nextDisabledSectionIds]));
    setHiddenFieldIds((current) => uniqueIds([...current.filter((id) => nextDisabledFieldIds.includes(id)), ...nextDisabledFieldIds]));
  }

  function applyHiddenRounds(nextHiddenIds: string[]) {
    setHiddenRoundIds(nextHiddenIds);
    const nextDisabledSectionIds = allSectionIds.filter((sectionId) => {
      const section = templates.flatMap((template) => template.sections ?? []).find((item) => item.id === sectionId);
      return section
        ? section.roundIds.length > 0 && section.roundIds.every((roundId) => nextHiddenIds.includes(roundId) || disabledRoundIds.includes(roundId))
        : false;
    });
    const nextDisabledFieldIds = allFieldIds.filter((fieldId) => {
      const owningTemplates = templates.filter((template) => template.fields.some((field) => field.id === fieldId));
      const field = templates.flatMap((template) => template.fields).find((item) => item.id === fieldId);
      const fieldWindowsHidden = field?.roundIds
        ? field.roundIds.length > 0 && field.roundIds.every((roundId) => nextHiddenIds.includes(roundId) || disabledRoundIds.includes(roundId))
        : false;
      const fieldSectionsHidden = field?.sectionIds
        ? field.sectionIds.length > 0 && field.sectionIds.every((sectionId) => hiddenSectionIds.includes(sectionId) || nextDisabledSectionIds.includes(sectionId))
        : false;
      return owningTemplates.every((template) => hiddenAssessmentIds.includes(template.id)) || fieldWindowsHidden || fieldSectionsHidden;
    });
    setHiddenSectionIds((current) => uniqueIds([...current.filter((id) => nextDisabledSectionIds.includes(id)), ...nextDisabledSectionIds]));
    setHiddenFieldIds((current) => uniqueIds([...current.filter((id) => nextDisabledFieldIds.includes(id)), ...nextDisabledFieldIds]));
  }

  function applyHiddenSections(nextHiddenIds: string[]) {
    setHiddenSectionIds(nextHiddenIds);
    const nextDisabledFieldIds = allFieldIds.filter((fieldId) => {
      const field = templates.flatMap((template) => template.fields).find((item) => item.id === fieldId);
      return field?.sectionIds
        ? field.sectionIds.length > 0 && field.sectionIds.every((sectionId) => nextHiddenIds.includes(sectionId) || disabledSectionIds.includes(sectionId))
        : false;
    });
    setHiddenFieldIds((current) => uniqueIds([...current.filter((id) => nextDisabledFieldIds.includes(id)), ...nextDisabledFieldIds]));
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Overview column options">
      <section className="notes-modal panel options-modal">
        <div className="modal-top">
          <div>
            <p className="eyebrow">Overview</p>
            <h2>Column options</h2>
          </div>
          <button className="small-action ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="options-grid">
          <ColumnOptionGroup
            title="Assessments"
            items={templates.map((template) => ({ id: template.id, label: template.name }))}
            hiddenIds={hiddenAssessmentIds}
            allIds={allAssessmentIds}
            setHiddenIds={applyHiddenAssessments}
          />
          <ColumnOptionGroup
            title="Windows"
            items={allRoundIds.map((roundId) => ({ id: roundId, label: templates.flatMap((template) => template.rounds).find((round) => round.id === roundId)?.label ?? roundId }))}
            hiddenIds={hiddenRoundIds}
            allIds={allRoundIds}
            disabledIds={disabledRoundIds}
            setHiddenIds={applyHiddenRounds}
          />
          <ColumnOptionGroup
            title="Sections"
            items={allSectionIds.map((sectionId) => ({ id: sectionId, label: templates.flatMap((template) => template.sections ?? []).find((section) => section.id === sectionId)?.name ?? sectionId }))}
            hiddenIds={hiddenSectionIds}
            allIds={allSectionIds}
            disabledIds={disabledSectionIds}
            setHiddenIds={applyHiddenSections}
          />
          <ColumnOptionGroup
            title="Fields"
            items={allFieldIds.map((fieldId) => ({ id: fieldId, label: templates.flatMap((template) => template.fields).find((field) => field.id === fieldId)?.name ?? fieldId }))}
            hiddenIds={hiddenFieldIds}
            allIds={allFieldIds}
            disabledIds={disabledFieldIds}
            setHiddenIds={setHiddenFieldIds}
          />
        </div>
      </section>
    </div>
  );
}

function ColumnOptionGroup({
  title,
  items,
  hiddenIds,
  allIds,
  disabledIds = [],
  setHiddenIds
}: {
  title: string;
  items: Array<{ id: string; label: string }>;
  hiddenIds: string[];
  allIds: string[];
  disabledIds?: string[];
  setHiddenIds: (hiddenIds: string[]) => void;
}) {
  function toggle(id: string) {
    if (disabledIds.includes(id)) return;
    setHiddenIds(hiddenIds.includes(id) ? hiddenIds.filter((item) => item !== id) : [...hiddenIds, id]);
  }
  const enabledIds = allIds.filter((id) => !disabledIds.includes(id));
  const allSelected = enabledIds.length > 0 && enabledIds.every((id) => !hiddenIds.includes(id));

  return (
    <div className="option-group">
      <div className="option-group-top">
        <h3>{title}</h3>
      </div>
      <div className="option-checks">
        <label className="checkbox-row select-all-row">
          <input
            checked={allSelected}
            onChange={() => setHiddenIds(allSelected ? uniqueIds([...hiddenIds, ...enabledIds]) : hiddenIds.filter((id) => disabledIds.includes(id)))}
            type="checkbox"
          />
          Select All
        </label>
        {items.map((item) => (
          <label className={disabledIds.includes(item.id) ? "checkbox-row disabled-option" : "checkbox-row"} key={item.id}>
            <input
              checked={!hiddenIds.includes(item.id) && !disabledIds.includes(item.id)}
              disabled={disabledIds.includes(item.id)}
              onChange={() => toggle(item.id)}
              type="checkbox"
            />
            {item.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function ReportFiles({
  rows,
  reports,
  setReports,
  recordAudit
}: {
  rows: OrfResultRow[];
  reports: UploadedReport[];
  setReports: React.Dispatch<React.SetStateAction<UploadedReport[]>>;
  recordAudit: RecordAudit;
}) {
  const [studentId, setStudentId] = useState(rows[0]?.id ?? "");
  const [assessment, setAssessment] = useState("star-reading");
  const [round, setRound] = useState("fall");
  const selectedStudent = rows.find((row) => row.id === studentId) ?? rows[0];

  function onFileSelected(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !selectedStudent) return;

    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = [
      "assessment-files",
      "2026-2027",
      selectedStudent.homeroom,
      assessment,
      round,
      selectedStudent.id,
      safeFileName
    ].join("/");

    setReports((current) => [
      {
        id: `report-${current.length + 1}`,
        studentId: selectedStudent.id,
        assessment,
        round,
        fileName: file.name,
        fileSize: file.size,
        storagePath
      },
      ...current
    ]);
    recordAudit("Selected report file", "Report attachment", selectedStudent.student, `Queued ${file.name} for ${assessment} / ${round} at ${storagePath}.`);
  }

  return (
    <section className="files-layout">
      <div className="panel files-controls">
        <p className="eyebrow">Report Files</p>
        <h2>Attach PDFs and downloaded reports</h2>
        <p>Star Reading, Star Math, Lexia, and other report-style assessments can be stored as files.</p>

        <label>
          Student
          <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.student} / {row.homeroom}
              </option>
            ))}
          </select>
        </label>

        <label>
          Assessment
          <select value={assessment} onChange={(event) => setAssessment(event.target.value)}>
            <option value="star-reading">Star Reading</option>
            <option value="star-math">Star Math</option>
            <option value="lexia">Lexia</option>
            <option value="custom-report">Custom report</option>
          </select>
        </label>

        <label>
          Round
          <select value={round} onChange={(event) => setRound(event.target.value)}>
            <option value="fall">September / Fall</option>
            <option value="winter">January / Winter</option>
            <option value="spring">May / Spring</option>
          </select>
        </label>

        <label>
          Select report file
          <input accept="application/pdf,.pdf,.png,.jpg,.jpeg" type="file" onChange={(event) => onFileSelected(event.target.files)} />
        </label>
      </div>

      <div className="panel files-list-panel">
        <div className="panel-heading">
          <p className="eyebrow">Storage Queue</p>
          <h2>Pending report attachments</h2>
        </div>

        <div className="files-list">
          {reports.length ? (
            reports.map((report) => (
              <article className="file-card" key={report.id}>
                <div>
                  <strong>{report.fileName}</strong>
                  <p>{report.assessment} / {report.round} / {Math.round(report.fileSize / 1024)} KB</p>
                </div>
                <code>{report.storagePath}</code>
              </article>
            ))
          ) : (
            <div className="empty-state">No report files selected yet.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function AuditLog({ events }: { events: AppAuditEvent[] }) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<"createdAt" | "eventType" | "entityType" | "entityLabel">("createdAt");
  const sortedEvents = useMemo(() => {
    const normalizedFilter = filter.toLowerCase();
    return [...events]
      .filter((event) =>
        [event.eventType, event.entityType, event.entityLabel, event.description, event.actor]
          .join(" ")
          .toLowerCase()
          .includes(normalizedFilter)
      )
      .sort((a, b) => String(b[sortKey]).localeCompare(String(a[sortKey])));
  }, [events, filter, sortKey]);

  return (
    <section className="audit-layout">
      <div className="panel audit-hero">
        <p className="eyebrow">Audit Log</p>
        <h2>Change history</h2>
        <p>A visible trail for score edits, assessment definition changes, report downloads, notes, and file selections.</p>
      </div>

      <section className="summary-strip">
        <div>
          <span>{events.length}</span>
          <p>Recorded events</p>
        </div>
        <div>
          <span>{new Set(events.map((event) => event.entityType)).size}</span>
          <p>Entity types touched</p>
        </div>
        <div>
          <span>{new Set(events.map((event) => event.actor)).size}</span>
          <p>Actors represented</p>
        </div>
        <div>
          <span>{events[0] ? new Date(events[0].createdAt).toLocaleDateString() : "-"}</span>
          <p>Latest change</p>
        </div>
      </section>

      <div className="panel audit-list-panel">
        <div className="audit-controls">
          <label>
            Filter
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search change logs" />
          </label>
          <label>
            Sort
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as typeof sortKey)}>
              <option value="createdAt">Date</option>
              <option value="eventType">Event</option>
              <option value="entityType">Entity type</option>
              <option value="entityLabel">Entity</option>
            </select>
          </label>
        </div>

        <div className="audit-table assessment-like-table" role="table" aria-label="Change logs">
          <div className="audit-table-row audit-table-head" role="row">
            <span>Event</span>
            <span>Entity</span>
            <span>Description</span>
            <span>Actor</span>
            <span>Date</span>
          </div>
          {sortedEvents.map((event) => (
            <div className="audit-table-row" role="row" key={event.id}>
              <span className="audit-type">{event.eventType}</span>
              <span>{event.entityLabel}</span>
              <span>{event.description}</span>
              <span>{event.actor}</span>
              <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function noteColumn(notes: StudentNote[], openNotes: (studentId: string) => void): ColDef<EntryRow> {
  return {
    colId: "notes",
    headerName: "",
    pinned: "left",
    width: 72,
    editable: false,
    sortable: false,
    filter: false,
    cellRenderer: (params: { data?: EntryRow }) => {
      const studentId = params.data?.id;
      const studentNotes = studentId ? notes.filter((note) => note.studentId === studentId) : [];
      const viewableNotes = studentNotes.filter((note) => note.permission === "all" || note.permission === "admin_only");
      return (
        <button
          className={viewableNotes.length ? "notes-icon has-notes" : "notes-icon"}
          onClick={() => studentId && openNotes(studentId)}
          title={viewableNotes.length ? "View student notes" : "Add student note"}
          type="button"
          aria-label={viewableNotes.length ? "View student notes" : "Add student note"}
        >
          ✎
        </button>
      );
    }
  };
}

type StudentNameCellRendererParams = {
  data?: EntryRow;
  value?: string;
  locked?: boolean;
  isDuplicate?: boolean;
  studentNameSuggestions?: string[];
  onMoveStudent?: (studentId: string) => void;
  onDeleteStudent?: (studentId: string) => void;
  onStudentNameChange?: (studentId: string, studentName: string) => void;
};

function StudentNameCellRenderer({
  data,
  value,
  locked = false,
  isDuplicate = false,
  studentNameSuggestions = [],
  onMoveStudent,
  onDeleteStudent,
  onStudentNameChange
}: StudentNameCellRendererParams) {
  const studentId = data?.id;
  const displayValue = String(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(displayValue);
  const [focused, setFocused] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 260 });
  const suggestions = useMemo(() => {
    const normalizedDraft = normalizeStudentName(draft);
    if (!normalizedDraft) return studentNameSuggestions.slice(0, 6);

    return studentNameSuggestions
      .filter((name) => {
        const normalizedName = normalizeStudentName(name);
        return normalizedName.includes(normalizedDraft) && normalizedName !== normalizedDraft;
      })
      .slice(0, 6);
  }, [draft, studentNameSuggestions]);

  useEffect(() => {
    setDraft(displayValue);
  }, [displayValue]);

  useEffect(() => {
    if (!focused) return;

    function updateMenuPosition() {
      const bounds = inputRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setMenuPosition({
        top: bounds.bottom + 4,
        left: bounds.left,
        width: Math.max(260, bounds.width)
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [draft, focused]);

  function commitName(nextName: string) {
    const cleanedName = nextName.trim().replace(/\s+/g, " ");
    setDraft(cleanedName);
    if (!studentId || !cleanedName || cleanedName === displayValue) return;
    onStudentNameChange?.(studentId, cleanedName);
  }

  function chooseSuggestion(name: string) {
    commitName(name);
    setFocused(false);
  }

  function selectWholeName(input: HTMLInputElement) {
    requestAnimationFrame(() => input.select());
  }

  function focusSiblingNameInput(input: HTMLInputElement, direction: 1 | -1) {
    const nameInputs = Array.from(document.querySelectorAll<HTMLInputElement>(".student-name-inline-input"));
    const currentIndex = nameInputs.indexOf(input);
    const nextInput = nameInputs[currentIndex + direction];
    if (!nextInput) return;

    nextInput.focus();
    selectWholeName(nextInput);
  }

  function handleNameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "Tab" || event.key === "Enter") && suggestions[0]) {
      event.preventDefault();
      event.stopPropagation();
      chooseSuggestion(suggestions[0]);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commitName(draft);
      event.currentTarget.blur();
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      commitName(draft);
      focusSiblingNameInput(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
    }
  }

  const suggestionMenu =
    focused && suggestions.length && typeof document !== "undefined"
      ? createPortal(
          <div
            className="student-name-suggestions"
            style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}
          >
            {suggestions.map((name, index) => (
              <button
                className={index === 0 ? "active" : ""}
                key={name}
                onMouseDown={(event) => {
                  event.preventDefault();
                  chooseSuggestion(name);
                }}
                type="button"
              >
                {name}
                {index === 0 ? <span>Tab</span> : null}
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={isDuplicate ? "student-cell-actions has-duplicate" : "student-cell-actions"}>
      {locked ? (
        <strong>{displayValue}</strong>
      ) : (
        <div className="student-name-inline">
          <input
            ref={inputRef}
            className="student-name-inline-input"
            value={draft}
            onBlur={() => {
              commitName(draft);
              setFocused(false);
            }}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setMenuPosition({ top: bounds.bottom + 4, left: bounds.left, width: Math.max(260, bounds.width) });
              setFocused(true);
              selectWholeName(event.currentTarget);
            }}
            onKeyDown={handleNameKeyDown}
            onKeyDownCapture={handleNameKeyDown}
          />
          {suggestionMenu}
        </div>
      )}
      {!locked ? (
        <>
          <button onClick={() => studentId && onMoveStudent?.(studentId)} type="button" aria-label={`Move ${displayValue}`}>
            Move
          </button>
          <button onClick={() => studentId && onDeleteStudent?.(studentId)} type="button" aria-label={`Remove ${displayValue}`}>
            X
          </button>
        </>
      ) : null}
    </div>
  );
}

function studentActionColumn(
  onMoveStudent: (studentId: string) => void,
  onDeleteStudent: (studentId: string) => void,
  onStudentNameChange: (studentId: string, studentName: string) => void,
  locked: boolean,
  duplicateStudentIds: string[] = [],
  studentNameSuggestions: string[] = []
): ColDef<EntryRow> {
  return {
    field: "student",
    headerName: "Student",
    pinned: "left",
    width: 210,
    filter: true,
    editable: false,
    cellClass: (params) =>
      ["student-name-grid-cell", params.data?.id && duplicateStudentIds.includes(params.data.id) ? "duplicate-student-cell" : ""]
        .filter(Boolean)
        .join(" "),
    cellRenderer: StudentNameCellRenderer,
    cellRendererParams: (params: { data?: EntryRow }) => ({
      locked,
      isDuplicate: Boolean(params.data?.id && duplicateStudentIds.includes(params.data.id)),
      studentNameSuggestions,
      onMoveStudent,
      onDeleteStudent,
      onStudentNameChange
    })
  };
}

function fieldColumn(
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  fieldScope = round.id,
  extraCellClass = ""
): ColDef<EntryRow> {
  const fieldName = tableFieldKey(fieldScope, field.slug);
  return {
    field: fieldName,
    headerName: field.name,
    width: field.name.length > 12 ? 150 : 104,
    editable: !field.isCalculated && field.dataType !== "file",
    cellEditor: field.dataType === "integer" || field.dataType === "percentage" ? "agNumberCellEditor" : undefined,
    valueParser: (params) =>
      field.dataType === "integer" || field.dataType === "percentage" ? toNumber(params.newValue) : params.newValue,
    cellClass: [field.isCalculated ? "locked-formula-cell" : "editable-score-cell", extraCellClass].filter(Boolean).join(" "),
    cellStyle: { backgroundColor: round.color ?? "#fffaf0" },
    headerClass: extraCellClass,
    headerStyle: { backgroundColor: round.color ?? "#fffaf0" },
    tooltipValueGetter: () => `${assessment.name} / ${round.label} / ${field.name}`
  };
}

function roundHeaderStyle(round: AssessmentRoundTemplate) {
  return {
    backgroundColor: round.color ?? "#fffaf0",
    color: "#101820"
  };
}

function columnsForRound(
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  fieldScope = round.id,
  hiddenFieldIds: string[] = [],
  hiddenSectionIds: string[] = []
): ColDef<EntryRow>[] {
  const fieldsForRound = assessment.fields.filter(
    (field) => !hiddenFieldIds.includes(field.id) && (!field.roundIds?.length || field.roundIds.includes(round.id))
  );
  const sectionsForRound = (assessment.sections ?? []).filter(
    (section) => section.roundIds.includes(round.id) && !hiddenSectionIds.includes(section.id)
  );
  const sectionColumns: ColDef<EntryRow>[] = sectionsForRound
    .flatMap((section) => {
      const sectionFields = fieldsForRound.filter((field) => field.sectionIds?.includes(section.id));
      if (!sectionFields.length) return [];
      return [{
        headerName: section.name,
        headerStyle: roundHeaderStyle(round),
        children: sectionFields.map((field, index) =>
          fieldColumn(
            assessment,
            round,
            field,
            `${fieldScope}_${section.id}`,
            index === sectionFields.length - 1 ? "hierarchy-boundary-cell" : ""
          )
        )
      }];
    });
  const unsectionedFields = fieldsForRound.filter((field) => !field.sectionIds?.some((sectionId) => sectionsForRound.some((section) => section.id === sectionId)));

  return [
    ...sectionColumns,
    ...unsectionedFields.map((field, index) =>
      fieldColumn(
        assessment,
        round,
        field,
        fieldScope,
        index === unsectionedFields.length - 1 ? "hierarchy-boundary-cell" : ""
      )
    )
  ];
}

function overviewColumnsFor(template: AssessmentTemplate): ColDef<EntryRow>[] {
  if (template.id === "orf") {
    return [
      { field: "orf_median", headerName: "Med", width: 100, cellClass: "locked-formula-cell" },
      { field: "orf_percentile", headerName: "%ile", width: 100, cellClass: "locked-formula-cell" }
    ];
  }
  if (template.id === "quick-write") {
    return [
      { field: "quick_write_tww", headerName: "TWW", width: 100 },
      { field: "quick_write_percentile", headerName: "%ile", width: 100 }
    ];
  }
  if (template.id === "ab-ed-numeracy") {
    return [
      { field: "numeracy_score", headerName: "Score", width: 110 },
      { field: "numeracy_total", headerName: "Total", width: 110 }
    ];
  }
  return [{ field: "report_status", headerName: "Report", width: 130 }];
}

function buildEntryRows(rows: OrfResultRow[], selected: AssessmentTemplate): EntryRow[] {
  return rows.map((row, index) => {
    const entry: EntryRow = { ...row };
    selected.rounds.forEach((round, roundIndex) => {
      assignFieldValues(entry, row, selected, round, round.id, index, roundIndex);
    });
    return entry;
  });
}

function buildOverviewRows(rows: OrfResultRow[], templates: AssessmentTemplate[]): EntryRow[] {
  return rows.map((row, index) => {
    const entry: EntryRow = { ...row };
    templates.forEach((template) => {
      template.rounds.forEach((round, roundIndex) => {
        assignFieldValues(entry, row, template, round, `${template.id}_${round.id}`, index, roundIndex);
      });
    });
    return entry;
  });
}

function assignFieldValues(
  entry: EntryRow,
  row: OrfResultRow,
  template: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  fieldScope: string,
  rowIndex: number,
  roundIndex: number
) {
  const sectionsForRound = (template.sections ?? []).filter((section) => section.roundIds.includes(round.id));
  template.fields
    .filter((field) => !field.roundIds?.length || field.roundIds.includes(round.id))
    .forEach((field, fieldIndex) => {
      const fieldSections = sectionsForRound.filter((section) => field.sectionIds?.includes(section.id));
      if (fieldSections.length) {
        fieldSections.forEach((section) => {
          entry[tableFieldKey(`${fieldScope}_${section.id}`, field.slug)] = entryValue(row, template, round, field, rowIndex, roundIndex, fieldIndex);
        });
        return;
      }
      entry[tableFieldKey(fieldScope, field.slug)] = entryValue(row, template, round, field, rowIndex, roundIndex, fieldIndex);
    });
}

function entryValue(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  rowIndex: number,
  roundIndex: number,
  fieldIndex: number
) {
  const isNewPlaceholderStudent = row.id.startsWith("student-") && row.student.startsWith("New Student");
  if (assessment.id === "orf" && round.id === "fall") {
    if (field.slug === "wpm") return row.septP1Wpm;
    if (field.slug === "epm") return row.septP1Epm;
    if (field.slug === "cwpm") return row.septP1Cwpm;
    if (field.slug === "median") return row.septMedian;
    if (field.slug === "percentile") return row.septPercentile;
  }
  if (isNewPlaceholderStudent) {
    return field.dataType === "file" || field.dataType === "letter" || field.dataType === "text" || field.dataType === "date" ? "" : null;
  }
  if (field.dataType === "file") return rowIndex % 2 === 0 ? "Attached" : "Needed";
  if (field.dataType === "letter") return ["A", "B", "C"][rowIndex % 3];
  if (field.dataType === "text") return "";
  if (field.dataType === "date") return "";
  return 20 + rowIndex * 4 + roundIndex * 6 + fieldIndex;
}

function tableFieldKey(roundId: string, fieldSlug: string) {
  return `${roundId}_${fieldSlug}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

function labelsForIds(items: Array<{ id: string; label?: string; name?: string }>, ids: string[]) {
  return ids
    .map((id) => {
      const item = items.find((candidate) => candidate.id === id);
      return item?.label ?? item?.name ?? id;
    })
    .join(", ");
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

function fieldWindowSummary(template: AssessmentTemplate, field: AssessmentFieldTemplate) {
  return field.roundIds?.length ? labelsForIds(template.rounds, field.roundIds) : "All windows";
}

function fieldSectionSummary(template: AssessmentTemplate, field: AssessmentFieldTemplate) {
  return field.sectionIds?.length ? labelsForIds(template.sections ?? [], field.sectionIds) : "No sections";
}

function uniqueStudentNames(rows: OrfResultRow[]) {
  return Array.from(
    new Map(
      rows
        .map((row) => row.student.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .map((name) => [normalizeStudentName(name), name])
    ).values()
  ).sort((first, second) => first.localeCompare(second));
}

function normalizeStudentName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function findOverviewStudentNameConflicts(
  rows: OrfResultRow[],
  selectedYear: string,
  savedState: WorkspaceStudentSnapshot | null
) {
  if (!savedState) return [];

  const savedRowsById = new Map(savedState.rows.map((row) => [row.id, row]));
  const savedPlacementsForYear = savedState.placements.filter((placement) => placement.schoolYear === selectedYear);
  const conflicts: DuplicateStudentNameConflict[] = [];
  const seenConflictKeys = new Set<string>();

  rows.forEach((row) => {
    const normalizedName = normalizeStudentName(row.student);
    if (!normalizedName) return;

    const savedRow = savedRowsById.get(row.id);
    const savedPlacement = savedPlacementsForYear.find((placement) => placement.studentId === row.id);
    const isChangedOrAdded =
      !savedRow || normalizeStudentName(savedRow.student) !== normalizedName || !savedPlacement;

    if (!isChangedOrAdded) return;

    const matchingPlacement = savedPlacementsForYear.find((placement) => {
      if (placement.studentId === row.id) return false;
      const placedRow = savedRowsById.get(placement.studentId);
      return placedRow ? normalizeStudentName(placedRow.student) === normalizedName : false;
    });

    if (!matchingPlacement) return;

    const conflictKey = `${row.id}:${normalizedName}:${matchingPlacement.grade}:${matchingPlacement.homeroom}`;
    if (seenConflictKeys.has(conflictKey)) return;

    seenConflictKeys.add(conflictKey);
    conflicts.push({
      studentId: row.id,
      name: row.student.trim().replace(/\s+/g, " "),
      existingGrade: matchingPlacement.grade,
      existingHomeroom: matchingPlacement.homeroom
    });
  });

  return conflicts;
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function validateCondition(condition: {
  conditionOperator: string;
  conditionJoinOperator: string;
}) {
  if (!comparisonOperators.includes(condition.conditionOperator)) {
    window.alert("The final condition operator must be a comparison operator: <, >, =, or !=.");
    return;
  }
  if (condition.conditionJoinOperator && comparisonOperators.includes(condition.conditionJoinOperator)) {
    window.alert("Only the last operator can be a comparison operator.");
    return;
  }
  window.alert("Condition saved.");
}

function viewTitle(view: AppView, assessmentName: string) {
  const titles: Record<AppView, string> = {
    overview: "Overview",
    dashboard: "Dashboard",
    assessment: assessmentName,
    report: "Student Report",
    files: "Report Files",
    profile: "Profile"
  };
  return titles[view];
}

function permissionLabel(permission: StudentNotePermission) {
  return permission === "admin_only" ? "Admin only" : "All";
}

function toNumber(value: unknown) {
  if (value === "" || value === null || typeof value === "undefined") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}
