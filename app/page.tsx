"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { flushSync } from "react-dom";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellValueChangedEvent,
  type ColDef,
  type ICellEditorParams
} from "ag-grid-community";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import * as XLSX from "xlsx-js-style";
import {
  EmailAuthProvider,
  getAuth,
  onIdTokenChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  type User
} from "firebase/auth";
import {
  assessmentTemplates,
  emptyCustomTemplate,
  normalizeAssessmentTemplates,
  type AssessmentDefinitionSnapshot,
  type AssessmentDataType,
  type AssessmentFieldTemplate,
  type AssessmentRoundTemplate,
  type AssessmentSectionTemplate,
  type AssessmentTemplate,
} from "@/lib/assessment-templates";
import {
  assessmentValueKey,
  buildEntryRows,
  buildOverviewRows,
  entryValue,
  fieldSectionSummary,
  fieldWindowSummary,
  assessmentFieldAppliesToGrade,
  isEditableAssessmentField,
  labelsForIds,
  sectionsForAssessmentRound,
  uniqueIds,
  updateAssessmentRowFromTableEdit,
  validateAssessmentTableEdit,
  validateAssessmentValue,
  type EntryRow
} from "@/lib/assessment-entry";
import { applySpreadsheetAssessmentValues } from "@/lib/spreadsheet-import";
import { ORF_PERCENTILE_CALCULATION_KEYS } from "@/lib/orf-calculations";
import {
  addDashboardChart,
  compactDashboardChartLabel,
  compactDashboardLegendLabel,
  dashboardAxisLabelCharacterLimit,
  dashboardLegendLabelCharacterLimit,
  dashboardYearGroups,
  formatDashboardTooltipLabel,
  labelDashboardYears,
  removeDashboardChart,
  type DashboardChartAxisPoint
} from "@/lib/dashboard-charts";
import { resolveScaleCodeEditorValue, validScaleCodeValue } from "@/lib/scale-code";
import {
  addReportStudentId,
  buildStudentReportBlocks,
  buildStudentReportWorksheetLayout,
  matchingReportStudentOptions,
  reconcileReportStudentIds,
  removeReportStudentId,
  STUDENT_REPORT_NO_DATA_ID,
  studentReportHeaderGroups,
  type StudentReportBlock,
  type StudentReportSourceRow,
  type StudentReportWorksheetBlock
} from "@/lib/student-report";
import {
  canCreateStudentNote,
  canMutateStudentNote,
  filterStudentNotesForRole,
  type StudentNotePermission
} from "@/lib/student-notes";
import {
  loadPrototypeWorkspaceState,
  revertSpreadsheetImport,
  savePrototypeWorkspaceState,
  saveStudentsToDatabase
} from "@/lib/student-database";
import {
  buildStudentIdentityOptions,
  buildStudentSearchOptions,
  canImportOverviewYear,
  deleteSchoolYearFromOverview,
  moveStudentToExistingHomeroom,
  parseOverviewStudentCount,
  reassignPlaceholderToExistingStudent,
  type StudentIdentityOption,
  type StudentPlacement,
  type StudentSearchOption
} from "@/lib/overview-state";
import {
  SUPPORTED_GRADES,
  latestSchoolYear,
  resolveTeamMemberAccess,
  teamAssignmentHomerooms
} from "@/lib/team-assignments";
import { firebaseApp } from "@/lib/firebase";
import { prepareInvitationHandoff } from "@/lib/invitation-handoff";
import { hydrateOrfRow, type OrfResultRow } from "@/lib/sample-results";
import { studentRowsNeedingSqlSync } from "@/lib/student-sync";
import {
  mergeAuditEvents,
  sortAuditEvents,
  type AuditSortKey,
  type OrganizationAuditEvent
} from "@/lib/audit-events";
import { recordOrganizationAuditEvent, watchOrganizationAuditEvents } from "@/lib/audit-log";
import {
  queueAuditEvent,
  readAuditOutbox,
  reconcileAuditOutbox,
  removeAuditEventFromOutbox
} from "@/lib/audit-outbox";
import {
  readNavigationPreference,
  writeNavigationPreference,
  type AppView,
  type AssessmentPageTab,
  type ProfilePageTab
} from "@/lib/navigation-preferences";
import {
  deleteOrganizationMember,
  inviteOrganizationMember,
  listOrganizationMembers,
  resolveOrganizationAccess,
  roles,
  updateOrganizationMemberAccess,
  watchOrganizationAccessChange,
  watchOrganizationAccessRevocation,
  type OrganizationAccess,
  type TeamMember,
  type UserRole
} from "@/lib/organization-auth";

ModuleRegistry.registerModules([AllCommunityModule]);

const dataTypes: AssessmentDataType[] = ["integer", "percentage", "letter", "text", "date", "file", "calculated"];
const dashboardYears = ["2026-2027", "2025-2026", "2024-2025"];
const predefinedCalculations = [
  {
    key: "median",
    label: "MED",
    description: "Calculates the MED of all CWPM values for the current window."
  },
  {
    key: ORF_PERCENTILE_CALCULATION_KEYS.fall,
    label: "ORF %ile — Fall (2017 norms)",
    description: "Applies Hasbrouck & Tindal 2017 fall anchors for Grades 2-6. The source has no Grade 1 fall norm."
  },
  {
    key: ORF_PERCENTILE_CALCULATION_KEYS.winter,
    label: "ORF %ile — Winter (2017 norms)",
    description: "Applies Hasbrouck & Tindal 2017 winter anchors for Grades 1-6 at every valid ORF MED."
  },
  {
    key: ORF_PERCENTILE_CALCULATION_KEYS.spring,
    label: "ORF %ile — Spring (2017 norms)",
    description: "Applies Hasbrouck & Tindal 2017 spring anchors for Grades 1-6 at every valid ORF MED."
  },
  {
    key: "quick_write_percentile",
    label: "Quick Write %ile",
    description: "Percentile-ranks Quick Write CWS within the current year, grade, and assessment window cohort."
  },
  {
    key: "percentage",
    label: "Percentage",
    description: "Calculates Score divided by Total in the current section, then multiplies by 100."
  },
  {
    key: "cc3_component_total",
    label: "CC3 component total",
    description: "Uses the official CC3 maximum of 40 for the applicable grade and window."
  },
  {
    key: "cc3_requires_support",
    label: "CC3 requires support",
    description: "Checks when Regular Words and either Irregular Words or Non-words fall in the provincial support ranges."
  },
  {
    key: "provincial_numeracy_component_total",
    label: "Provincial numeracy total",
    description: "Uses the official maximum possible score for the applicable component, grade, and window."
  },
  {
    key: "provincial_numeracy_weighted_score",
    label: "Provincial numeracy weighted score",
    description: "Calculates and rounds the official weighted screener score to a maximum of 100."
  },
  {
    key: "provincial_numeracy_requires_support",
    label: "Provincial numeracy requires support",
    description: "Checks when the completed weighted score falls in the provincial support range."
  }
] as const;
const defaultCalculationKey = predefinedCalculations[0].key;
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

type SaveStatus = "saved" | "dirty" | "saving" | "error";
type ImportRevertOutcome = "reverted" | "reverted-audit-pending" | "cancelled" | "unavailable";
type AppAuditEvent = OrganizationAuditEvent;
type RecordAudit = (
  eventType: string,
  entityType: string,
  entityLabel: string,
  description: string,
  options?: { importLogId?: string }
) => string;
type DefaultValueTarget = {
  fieldName: string;
  field: AssessmentFieldTemplate;
  label: string;
  scaleCodes: string[];
};
type OverviewDialog =
  | { type: "add" }
  | { type: "move"; studentId: string }
  | { type: "delete"; studentId: string }
  | { type: "import" }
  | null;

export default function StudentEvaluationApp() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [invitationHandoffComplete, setInvitationHandoffComplete] = useState(false);
  const [templates, setTemplates] = useState<AssessmentTemplate[]>(assessmentTemplates);
  const [selectedId, setSelectedId] = useState(assessmentTemplates[0].id);
  const [activeView, setActiveView] = useState<AppView>("overview");
  const [assessmentPageTab, setAssessmentPageTab] = useState<AssessmentPageTab>("entry");
  const [profilePageTab, setProfilePageTab] = useState<ProfilePageTab>("profile");
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>("Teacher / EA");
  const [userProfile, setUserProfile] = useState({ name: "", email: "", grade: "3", homeroom: "3A" });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [organizationAccess, setOrganizationAccess] = useState<OrganizationAccess>("checking");
  const [workspaceReadyForUid, setWorkspaceReadyForUid] = useState<string | null>(null);
  const [navigationReadyForUid, setNavigationReadyForUid] = useState<string | null>(null);
  const [orfRows, setOrfRows] = useState<OrfResultRow[]>([]);
  const [schoolYears, setSchoolYears] = useState(dashboardYears);
  const [selectedOverviewYear, setSelectedOverviewYear] = useState(dashboardYears[0]);
  const [selectedOverviewGrade, setSelectedOverviewGrade] = useState("3");
  const [tableFullScreen, setTableFullScreen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveMessage, setSaveMessage] = useState("No unsaved table changes.");
  const [unsavedAlertDismissed, setUnsavedAlertDismissed] = useState(false);
  const [databaseStudentOptions, setDatabaseStudentOptions] = useState<StudentIdentityOption[]>([]);
  const [overviewDuplicateConflicts, setOverviewDuplicateConflicts] = useState<DuplicateStudentNameConflict[]>([]);
  const [overviewChangedStudentIds, setOverviewChangedStudentIds] = useState<Set<string>>(new Set());
  const [overviewStudentFilterId, setOverviewStudentFilterId] = useState<string | null>(null);
  const [lastSavedWorkspaceState, setLastSavedWorkspaceState] = useState<SavedWorkspaceState | null>(null);
  const [lockedOverviewYears, setLockedOverviewYears] = useState<string[]>([]);
  const [overviewPlacements, setOverviewPlacements] = useState<StudentPlacement[]>([]);
  const [uploadedReports, setUploadedReports] = useState<UploadedReport[]>([]);
  const [activeNoteStudentId, setActiveNoteStudentId] = useState<string | null>(null);
  const [overviewDialog, setOverviewDialog] = useState<OverviewDialog>(null);
  const [importLogs, setImportLogs] = useState<ImportChangeLog[]>([]);
  const revertingImportIdsRef = useRef(new Set<string>());
  const handledAccessChangeRef = useRef<string | null>(null);
  const pendingStudentSyncAttemptRef = useRef<SavedWorkspaceState | null>(null);
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
  const [pendingAuditEventIds, setPendingAuditEventIds] = useState<Set<string>>(new Set());
  const [retryingAuditEventId, setRetryingAuditEventId] = useState<string | null>(null);
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
      author: "Teacher / EA",
      createdAt: "2026-06-09"
    }
  ]);
  const [draftField, setDraftField] = useState({
    name: "",
    dataType: "integer" as AssessmentDataType,
    isCalculated: false,
    calculationKey: defaultCalculationKey as string,
    letterRanks: "",
    selectedRoundIds: [] as string[],
    selectedSectionIds: [] as string[]
  });

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? templates[0],
    [selectedId, templates]
  );
  const isAdmin = currentUserRole === "Admin";
  const newestSchoolYear = useMemo(() => latestSchoolYear(schoolYears), [schoolYears]);
  const assignmentHomerooms = useMemo(
    () => teamAssignmentHomerooms(overviewPlacements, newestSchoolYear),
    [newestSchoolYear, overviewPlacements]
  );
  const authorizedNotes = useMemo(
    () => filterStudentNotesForRole(notes, currentUserRole),
    [currentUserRole, notes]
  );
  const [builderDefinitionYearsByAssessment, setBuilderDefinitionYearsByAssessment] = useState<Record<string, string[]>>({});
  const builderDefinitionYears = builderDefinitionYearsByAssessment[selectedId] ?? schoolYears;
  const builderSelected = useMemo(
    () => assessmentTemplateForDefinitionScope(selected, builderDefinitionYears, schoolYears),
    [builderDefinitionYears, schoolYears, selected]
  );
  const selectedTableTemplate = useMemo(
    () => assessmentTemplateForYear(selected, selectedOverviewYear),
    [selected, selectedOverviewYear]
  );
  const savedDefinitionYears = useMemo(() => {
    const savedTemplate = lastSavedWorkspaceState?.templates.find((template) => template.id === selectedId);
    return Object.keys(savedTemplate?.yearDefinitions ?? {});
  }, [lastSavedWorkspaceState, selectedId]);
  const overviewTemplatesForYear = useMemo(
    () => templates.map((template) => assessmentTemplateForYear(template, selectedOverviewYear)),
    [selectedOverviewYear, templates]
  );
  const activeOverviewRows = useMemo(
    () =>
      overviewPlacements
        .filter(
          (placement) =>
            placement.schoolYear === selectedOverviewYear &&
            placement.grade === selectedOverviewGrade &&
            (isAdmin || !userProfile.homeroom || placement.homeroom === userProfile.homeroom)
        )
        .map((placement) => {
          const row = orfRows.find((studentRow) => studentRow.id === placement.studentId);
          return row ? { ...row, homeroom: placement.homeroom } : null;
        })
        .filter((row): row is OrfResultRow => Boolean(row)),
    [isAdmin, orfRows, overviewPlacements, selectedOverviewGrade, selectedOverviewYear, userProfile.homeroom]
  );
  const overviewStudentSearchOptions = useMemo(
    () => buildStudentSearchOptions(orfRows, overviewPlacements),
    [orfRows, overviewPlacements]
  );
  const authorizedPlacements = useMemo(
    () =>
      isAdmin
        ? overviewPlacements
        : overviewPlacements.filter(
            (placement) =>
              placement.schoolYear === selectedOverviewYear &&
              placement.grade === userProfile.grade &&
              (!userProfile.homeroom || placement.homeroom === userProfile.homeroom)
          ),
    [isAdmin, overviewPlacements, selectedOverviewYear, userProfile.grade, userProfile.homeroom]
  );
  const authorizedRows = useMemo(() => {
    if (isAdmin) return orfRows;
    const authorizedStudentIds = new Set(authorizedPlacements.map((placement) => placement.studentId));
    return orfRows.filter((row) => authorizedStudentIds.has(row.id));
  }, [authorizedPlacements, isAdmin, orfRows]);
  const activeNoteStudent = activeNoteStudentId
    ? authorizedRows.find((row) => row.id === activeNoteStudentId) ?? null
    : null;
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
  const lockedFieldCount = builderSelected.fields.filter((field) => field.isCalculated).length;
  const evaluatorFieldCount = selectedTableTemplate.fields.filter((field) => field.visibility === "evaluators").length;

  useEffect(() => {
    const auth = getAuth(firebaseApp);
    let unsubscribe = () => {};
    let cancelled = false;
    let authGeneration = 0;
    let activeUid: string | null | undefined;

    async function startAuthentication() {
      const invitationHandoff = await prepareInvitationHandoff({
        href: window.location.href,
        waitForAuthReady: () => auth.authStateReady(),
        hasCurrentUser: () => Boolean(auth.currentUser),
        signOutCurrentUser: () => signOut(auth),
        replaceUrl: (url) => window.history.replaceState({}, "", url)
      });
      if (invitationHandoff) setInvitationHandoffComplete(true);

      if (cancelled) return;
      unsubscribe = onIdTokenChanged(auth, async (user) => {
        const generation = ++authGeneration;
        const nextUid = user?.uid ?? null;
        const accountChanged = activeUid !== nextUid;
        activeUid = nextUid;
        const isCurrentSession = () =>
          !cancelled
          && generation === authGeneration
          && auth.currentUser?.uid === user?.uid;

        setAuthUser(user);
        if (accountChanged) {
          setAuthReady(false);
          setOrganizationAccess("checking");
          setWorkspaceReadyForUid(null);
          setNavigationReadyForUid(null);
          setPendingAuditEventIds(new Set());
          pendingStudentSyncAttemptRef.current = null;
          setActiveNoteStudentId(null);
          setOverviewDialog(null);
        }

        if (!user) {
          setTeamMembers([]);
          setOrganizationAccess("uninvited");
          setAuthReady(true);
          return;
        }

        if (accountChanged) {
          const pendingEvents = readAuditOutbox(user.uid);
          setPendingAuditEventIds(new Set(pendingEvents.map((event) => event.id)));
          setAuditEvents((current) => mergeAuditEvents(current, pendingEvents));
        }

        const fallbackName = user.displayName || user.email?.split("@")[0] || "Team Member";
        if (accountChanged) {
          setUserProfile({
            name: fallbackName,
            email: user.email || "",
            grade: "",
            homeroom: ""
          });
        }

        try {
          const membership = await resolveOrganizationAccess(user);
          if (!isCurrentSession()) return;
          setOrganizationAccess(membership.access);
          if (!membership.role) setTeamMembers([]);
          if (membership.role) {
            setCurrentUserRole(membership.role);
            setUserProfile((profile) => ({
              ...profile,
              grade: membership.grade,
              homeroom: membership.homeroom
            }));
            if (membership.role === "Admin") {
              try {
                const members = await listOrganizationMembers();
                if (!isCurrentSession()) return;
                setTeamMembers(members);
              } catch {
                if (!isCurrentSession()) return;
                setTeamMembers([
                  {
                    id: user.uid,
                    name: fallbackName,
                    email: user.email || "",
                    role: membership.role,
                    status: "active",
                    grade: membership.grade,
                    homeroom: membership.homeroom
                  }
                ]);
              }
            } else {
              setTeamMembers([
                {
                  id: user.uid,
                  name: fallbackName,
                  email: user.email || "",
                  role: membership.role,
                  status: "active",
                  grade: membership.grade,
                  homeroom: membership.homeroom
                }
              ]);
            }
          }
        } catch (error) {
          if (!isCurrentSession()) return;
          if (isRemovedAuthSession(error)) {
            await signOut(auth);
          } else {
            setOrganizationAccess("uninvited");
          }
        } finally {
          if (accountChanged && isCurrentSession()) setAuthReady(true);
        }
      });
    }

    void startAuthentication();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authUser || organizationAccess !== "active") return;
    return watchOrganizationAccessRevocation(authUser.uid, () => {
      void signOut(getAuth(firebaseApp));
    });
  }, [authUser, organizationAccess]);

  useEffect(() => {
    if (!authUser || organizationAccess !== "active") return;
    return watchOrganizationAccessChange(authUser.uid, (version) => {
      const accessChangeKey = `${authUser.uid}:${version}`;
      if (handledAccessChangeRef.current === accessChangeKey) return;
      handledAccessChangeRef.current = accessChangeKey;
      void authUser.getIdToken(true).catch(() => signOut(getAuth(firebaseApp)));
    });
  }, [authUser, organizationAccess]);

  useEffect(() => {
    if (
      !authReady
      || !authUser
      || organizationAccess !== "active"
      || workspaceReadyForUid !== authUser.uid
      || navigationReadyForUid === authUser.uid
    ) return;
    const preference = readNavigationPreference(
      authUser.uid,
      currentUserRole,
      templates.map((template) => template.id),
      schoolYears
    );
    setActiveView(preference.activeView);
    setAssessmentPageTab(preference.assessmentPageTab);
    setProfilePageTab(preference.profilePageTab);
    if (preference.selectedAssessmentId) setSelectedId(preference.selectedAssessmentId);
    if (preference.selectedSchoolYear) setSelectedOverviewYear(preference.selectedSchoolYear);
    setTableFullScreen(false);
    setNavigationReadyForUid(authUser.uid);
  }, [authReady, authUser, currentUserRole, navigationReadyForUid, organizationAccess, schoolYears, templates, workspaceReadyForUid]);

  useEffect(() => {
    if (!authUser || organizationAccess !== "active" || navigationReadyForUid !== authUser.uid) return;
    writeNavigationPreference(authUser.uid, {
      version: 2,
      activeView,
      assessmentPageTab,
      profilePageTab,
      selectedAssessmentId: selectedId,
      selectedSchoolYear: selectedOverviewYear
    });
  }, [activeView, assessmentPageTab, authUser, navigationReadyForUid, organizationAccess, profilePageTab, selectedId, selectedOverviewYear]);

  useEffect(() => {
    if (!authUser || organizationAccess !== "active" || !isAdmin) return;
    return watchOrganizationAuditEvents(
      (cloudEvents) => {
        const pendingEvents = reconcileAuditOutbox(
          authUser.uid,
          new Set(cloudEvents.map((event) => event.id))
        );
        setPendingAuditEventIds(new Set(pendingEvents.map((event) => event.id)));
        setAuditEvents((current) => mergeAuditEvents(current, cloudEvents, pendingEvents));
      },
      (error) => console.error("Audit history could not be loaded from Firestore.", error)
    );
  }, [authUser, isAdmin, organizationAccess]);

  useEffect(() => {
    if (
      !authReady
      || !authUser
      || organizationAccess !== "active"
      || workspaceReadyForUid === authUser.uid
    ) return;
    let cancelled = false;
    const authenticatedUid = authUser.uid;

    async function loadSavedStudents() {
      try {
        const savedState = await loadPrototypeWorkspaceState();
        if (cancelled) return;
        if (savedState) {
          const normalizedTemplates = normalizeAssessmentTemplates(savedState.templates);
          const normalizedSavedState = { ...savedState, templates: normalizedTemplates };
          if (cancelled || getAuth(firebaseApp).currentUser?.uid !== authenticatedUid) return;
          setOrfRows(savedState.rows);
          setOverviewPlacements(savedState.placements);
          setTemplates(normalizedTemplates);
          setSchoolYears(savedState.schoolYears);
          setLastSavedWorkspaceState(normalizedSavedState);
          setDatabaseStudentOptions(buildStudentIdentityOptions(savedState.rows, savedState.placements));
          setOverviewChangedStudentIds(new Set());
          setLockedOverviewYears(savedState.lockedOverviewYears ?? []);
          if (savedState.auditEvents) {
            setAuditEvents((current) => mergeAuditEvents(savedState.auditEvents, current));
          }
          setImportLogs(savedState.importLogs ?? []);
          setSaveStatus("saved");
          setSaveMessage("Loaded the saved table workspace from Firebase.");
          return;
        }

        const cleanState: SavedWorkspaceState = {
          rows: [],
          placements: [],
          templates: assessmentTemplates,
          schoolYears: dashboardYears,
          lockedOverviewYears: [],
          auditEvents,
          importLogs: []
        };
        setOrfRows([]);
        setOverviewPlacements([]);
        setTemplates(assessmentTemplates);
        setSchoolYears(dashboardYears);
        setLastSavedWorkspaceState(cleanState);
        setDatabaseStudentOptions([]);
        setOverviewChangedStudentIds(new Set());
        setLockedOverviewYears([]);
        setSaveStatus("saved");
        setSaveMessage("No saved workspace found. Starting with a clean slate.");
      } catch (error) {
        if (cancelled) return;
        setSaveStatus("error");
        setSaveMessage(error instanceof Error ? error.message : "Could not load saved students from Firebase.");
      } finally {
        if (!cancelled) setWorkspaceReadyForUid(authenticatedUid);
      }
    }

    loadSavedStudents();
    return () => {
      cancelled = true;
    };
  }, [authReady, authUser, organizationAccess, workspaceReadyForUid]);

  useEffect(() => {
    if (
      !authUser
      || organizationAccess !== "active"
      || !isAdmin
      || workspaceReadyForUid !== authUser.uid
      || !lastSavedWorkspaceState?.pendingStudentSync
      || pendingStudentSyncAttemptRef.current === lastSavedWorkspaceState
    ) return;

    let cancelled = false;
    const authenticatedUid = authUser.uid;
    const pendingState = lastSavedWorkspaceState;
    pendingStudentSyncAttemptRef.current = pendingState;
    setSaveStatus("saving");
    setSaveMessage("Completing pending SQL student synchronization...");

    async function recoverPendingStudentSync() {
      try {
        await saveStudentsToDatabase(pendingState.rows);
        if (cancelled || getAuth(firebaseApp).currentUser?.uid !== authenticatedUid) return;
        const reconciledWorkspaceState = await savePrototypeWorkspaceState({
          ...pendingState,
          pendingStudentSync: false
        });
        if (cancelled || getAuth(firebaseApp).currentUser?.uid !== authenticatedUid) return;
        setLastSavedWorkspaceState(reconciledWorkspaceState);
        setSaveStatus("saved");
        setSaveMessage("Loaded the workspace and completed its pending SQL synchronization.");
      } catch (error) {
        if (cancelled) return;
        const syncError = error instanceof Error ? error : new Error("The pending SQL synchronization failed.");
        setSaveStatus("error");
        setSaveMessage(`Loaded the workspace, but its pending SQL synchronization still needs attention. ${syncError.message}`);
      }
    }

    void recoverPendingStudentSync();
    return () => {
      cancelled = true;
    };
  }, [authUser, isAdmin, lastSavedWorkspaceState, organizationAccess, workspaceReadyForUid]);

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
    if (!authUser || organizationAccess !== "active" || navigationReadyForUid !== authUser.uid) return;
    if (isAdmin) return;
    if (activeView !== "dashboard" && activeView !== "assessment" && activeView !== "profile") {
      setActiveView("dashboard");
    }
    if (assessmentPageTab !== "entry") {
      setAssessmentPageTab("entry");
    }
  }, [activeView, assessmentPageTab, authUser, isAdmin, navigationReadyForUid, organizationAccess]);

  useEffect(() => {
    if (organizationAccess !== "active" || isAdmin) return;
    const currentSchoolYear = newestSchoolYear;
    if (currentSchoolYear && selectedOverviewYear !== currentSchoolYear) {
      setSelectedOverviewYear(currentSchoolYear);
    }
    if (userProfile.grade && selectedOverviewGrade !== userProfile.grade) {
      setSelectedOverviewGrade(userProfile.grade);
    }
  }, [isAdmin, newestSchoolYear, organizationAccess, selectedOverviewGrade, selectedOverviewYear, userProfile.grade]);

  function markUnsaved(message = "You have unsaved table changes.") {
    setSaveStatus("dirty");
    setSaveMessage(message);
    setUnsavedAlertDismissed(false);
  }

  function restoreLastSavedWorkspace() {
    if (!lastSavedWorkspaceState) {
      setOverviewDuplicateConflicts([]);
      setOverviewChangedStudentIds(new Set());
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
    if (lastSavedWorkspaceState.auditEvents) {
      setAuditEvents((current) => mergeAuditEvents(lastSavedWorkspaceState.auditEvents, current));
    }
    setImportLogs(lastSavedWorkspaceState.importLogs ?? []);
    setDatabaseStudentOptions(buildStudentIdentityOptions(lastSavedWorkspaceState.rows, lastSavedWorkspaceState.placements));
    setOverviewDuplicateConflicts([]);
    setOverviewChangedStudentIds(new Set());
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
    setTableFullScreen(false);
    setActiveView(view);
  }

  function changeAssessmentTab(tab: AssessmentPageTab) {
    if (!confirmUnsavedChanges()) return;
    setTableFullScreen(false);
    setAssessmentPageTab(tab);
  }

  async function changeTeamMemberAccess(
    memberId: string,
    access: { role: UserRole; grade: string; homeroom: string }
  ) {
    const previousMember = teamMembers.find((member) => member.id === memberId);
    setTeamMembers((current) =>
      current.map((member) => (member.id === memberId ? { ...member, ...access } : member))
    );
    try {
      const updatedMember = await updateOrganizationMemberAccess(memberId, access);
      setTeamMembers((current) =>
        current.map((member) => (member.id === updatedMember.id ? updatedMember : member))
      );
      recordAudit(
        "Changed team access",
        "Team",
        updatedMember.email,
        updatedMember.role === "Admin"
          ? "Assigned Admin access."
          : `Assigned ${updatedMember.role} to Grade ${updatedMember.grade || "-"}, HR ${updatedMember.homeroom || "All home rooms"}.`
      );
    } catch (error) {
      if (previousMember) {
        setTeamMembers((current) =>
          current.map((member) => (member.id === previousMember.id ? previousMember : member))
        );
      }
      throw error;
    }
  }

  async function deleteTeamMember(memberId: string) {
    const member = teamMembers.find((item) => item.id === memberId);
    const deletedUid = await deleteOrganizationMember(memberId);
    setTeamMembers((current) => current.filter((item) => item.id !== deletedUid));
    recordAudit("Deleted team member", "Team", member?.email ?? memberId, "Removed application access.");
    if (authUser?.uid === deletedUid) {
      await signOut(getAuth(firebaseApp));
    }
  }

  async function saveTablesToFirebase(options?: { templatesOverride?: AssessmentTemplate[] }) {
    setSaveStatus("saving");
    setSaveMessage("Saving table changes to Firebase...");
    let workspaceSavedWithPendingSync: SavedWorkspaceState | null = null;
    try {
      let rowsForSave = orfRows;
      let placementsForSave = overviewPlacements;
      const templatesForSave = options?.templatesOverride ?? templates;

      if (activeView === "overview") {
        const savedState = lastSavedWorkspaceState;
        const rowsForCurrentOverview = overviewRowsForSelection(
          rowsForSave,
          placementsForSave,
          selectedOverviewYear,
          selectedOverviewGrade
        );
        const conflicts = findOverviewStudentNameConflicts(
          rowsForCurrentOverview,
          selectedOverviewYear,
          selectedOverviewGrade,
          savedState,
          overviewChangedStudentIds
        );

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

      const studentRowsForSync = isAdmin
        ? lastSavedWorkspaceState?.pendingStudentSync
          ? rowsForSave
          : studentRowsNeedingSqlSync(lastSavedWorkspaceState?.rows ?? [], rowsForSave)
        : [];
      const studentSyncRequired = studentRowsForSync.length > 0;
      const pendingWorkspaceState: SavedWorkspaceState = {
        rows: rowsForSave,
        placements: placementsForSave,
        templates: templatesForSave,
        schoolYears,
        lockedOverviewYears,
        auditEvents,
        importLogs,
        pendingStudentSync: studentSyncRequired
      };
      const firstSavedWorkspaceState = await savePrototypeWorkspaceState(pendingWorkspaceState);
      let result = { createdCount: 0, updatedCount: 0 };
      let workspaceState = firstSavedWorkspaceState;
      if (studentSyncRequired) {
        workspaceSavedWithPendingSync = firstSavedWorkspaceState;
        // This save already owns the SQL sync. Claim the pending state before
        // publishing it so the reload-recovery effect cannot start a duplicate sync.
        pendingStudentSyncAttemptRef.current = firstSavedWorkspaceState;
        setLastSavedWorkspaceState(firstSavedWorkspaceState);
        result = await saveStudentsToDatabase(studentRowsForSync);
        workspaceState = await savePrototypeWorkspaceState({
          ...firstSavedWorkspaceState,
          pendingStudentSync: false
        });
        workspaceSavedWithPendingSync = null;
      }
      setLastSavedWorkspaceState(workspaceState);
      if (activeView === "profile" && authUser && userProfile.name && userProfile.name !== authUser.displayName) {
        await updateProfile(authUser, { displayName: userProfile.name });
      }
      setTemplates(templatesForSave);
      setOrfRows(workspaceState.rows);
      setOverviewPlacements(workspaceState.placements);
      setDatabaseStudentOptions(buildStudentIdentityOptions(workspaceState.rows, workspaceState.placements));
      setOverviewChangedStudentIds(new Set());
      setSaveStatus("saved");
      setSaveMessage(
        activeView === "profile"
          ? "Saved profile data to Firebase."
          : !isAdmin
          ? "Saved assessment results for your assigned class."
          : studentSyncRequired
          ? `Saved to Firebase and synchronized student changes. ${result.createdCount} new student${result.createdCount === 1 ? "" : "s"} added; ${result.updatedCount} updated.`
          : "Saved to Firebase. No student database synchronization was needed."
      );
      recordAudit(
        "Saved table",
        "Firebase Data Connect",
        isAdmin ? "Student table" : "Assigned assessment table",
        isAdmin
          ? studentSyncRequired
            ? `Saved ${studentRowsForSync.length} changed student identit${studentRowsForSync.length === 1 ? "y" : "ies"} to the SQL Student table.`
            : "Saved workspace changes; student identities were already synchronized."
          : "Saved evaluator-visible assessment results through the server-enforced classroom scope."
      );
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(
        workspaceSavedWithPendingSync
          ? `The workspace is saved, but SQL synchronization is still pending and will retry on reload. ${error instanceof Error ? error.message : "Firebase Data Connect failed."}`
          : error instanceof Error ? error.message : "Firebase save failed."
      );
    }
  }

  function updateSelected(patch: Partial<AssessmentTemplate>) {
    setTemplates((current) =>
      current.map((template) =>
        template.id === selectedId ? updateAssessmentTemplateForYears(template, builderDefinitionYears, schoolYears, patch) : template
      )
    );
    markUnsaved("Assessment Builder changed. Save to update Firebase.");
  }

  async function saveAssessmentBuilder(definitionYears: string[]) {
    const templatesForSave = templates.map((template) =>
      template.id === selected.id ? { ...template, definitionYears } : template
    );
    await saveTablesToFirebase({ templatesOverride: templatesForSave });
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
      id: `${selected.id}-${slug}-${builderSelected.fields.length + 1}`,
      name,
      slug,
      dataType: draftField.isCalculated ? "calculated" : draftField.dataType,
      isRequired: false,
      isCalculated: draftField.isCalculated,
      calculationKey: draftField.isCalculated ? draftField.calculationKey : undefined,
      calculationExpression: undefined,
      letterRanks: draftField.dataType === "letter" || draftField.dataType === "text" ? draftField.letterRanks.trim() : undefined,
      roundIds: draftField.selectedRoundIds.length ? draftField.selectedRoundIds : undefined,
      sectionIds: draftField.selectedSectionIds.length ? draftField.selectedSectionIds : undefined,
      visibility: "evaluators"
    };

    updateSelected({ fields: [...builderSelected.fields, nextField] });
    recordAudit(
      draftField.isCalculated ? "Added formula field" : "Added field",
      "Assessment field",
      `${builderSelected.name} / ${name}`,
      `Added ${nextField.dataType} field.`
    );
    setDraftField({
      name: "",
      dataType: "integer",
      isCalculated: false,
      calculationKey: defaultCalculationKey as string,
      letterRanks: "",
      selectedRoundIds: [],
      selectedSectionIds: []
    });
  }

  function removeField(fieldId: string) {
    const removedField = builderSelected.fields.find((field) => field.id === fieldId);
    updateSelected({ fields: builderSelected.fields.filter((field) => field.id !== fieldId) });
    if (removedField) {
      recordAudit(
        "Removed field",
        "Assessment field",
        `${builderSelected.name} / ${removedField.name}`,
        "Removed a configurable assessment field from the active definition."
      );
    }
  }

  function addRound() {
    const roundNumber = builderSelected.rounds.length + 1;
    const nextRound: AssessmentRoundTemplate = {
      id: `round-${Date.now()}`,
      label: `Round ${roundNumber}`,
      month: "Custom",
      color: pastelRoundColors[(roundNumber - 1) % pastelRoundColors.length]
    };
    updateSelected({ rounds: [...builderSelected.rounds, nextRound] });
    recordAudit("Added round", "Assessment round", `${builderSelected.name} / ${nextRound.label}`, "Added a new assessment round.");
  }

  function updateRound(roundId: string, patch: Partial<AssessmentRoundTemplate>) {
    const round = builderSelected.rounds.find((item) => item.id === roundId);
    updateSelected({
      rounds: builderSelected.rounds.map((item) => (item.id === roundId ? { ...item, ...patch } : item))
    });
    if (round && patch.label) {
      recordAudit(
        "Edited round",
        "Assessment round",
        `${builderSelected.name} / ${patch.label}`,
        `Changed round title from ${round.label} to ${patch.label}.`
      );
    }
  }

  function removeRound(roundId: string) {
    const removedRound = builderSelected.rounds.find((round) => round.id === roundId);
    updateSelected({ rounds: builderSelected.rounds.filter((round) => round.id !== roundId) });
    if (removedRound) {
      recordAudit(
        "Removed round",
        "Assessment round",
        `${builderSelected.name} / ${removedRound.label}`,
        "Removed an assessment round."
      );
    }
  }

  function addSection() {
    const nextSection: AssessmentSectionTemplate = {
      id: `section-${Date.now()}`,
      name: `Section ${(builderSelected.sections?.length ?? 0) + 1}`,
      roundIds: builderSelected.rounds[0] ? [builderSelected.rounds[0].id] : []
    };
    updateSelected({ sections: [...(builderSelected.sections ?? []), nextSection] });
    recordAudit("Added section", "Assessment section", `${builderSelected.name} / ${nextSection.name}`, "Added an optional assessment window section.");
  }

  function updateSection(sectionId: string, patch: Partial<AssessmentSectionTemplate>) {
    updateSelected({
      sections: (builderSelected.sections ?? []).map((section) => (section.id === sectionId ? { ...section, ...patch } : section))
    });
  }

  function removeSection(sectionId: string) {
    const removed = builderSelected.sections?.find((section) => section.id === sectionId);
    updateSelected({
      sections: (builderSelected.sections ?? []).filter((section) => section.id !== sectionId),
      fields: builderSelected.fields.map((field) => ({
        ...field,
        sectionIds: field.sectionIds?.filter((id) => id !== sectionId)
      }))
    });
    if (removed) {
      recordAudit("Removed section", "Assessment section", `${builderSelected.name} / ${removed.name}`, "Removed an optional assessment section.");
    }
  }

  function addNote(studentId: string, body: string, permission: StudentNotePermission) {
    const student = authorizedRows.find((row) => row.id === studentId);
    const trimmed = body.trim();
    if (!student || !trimmed || !canCreateStudentNote(permission, currentUserRole)) return;
    setNotes((current) => [
      {
        id: `note-${Date.now()}`,
        studentId,
        permission,
        body: trimmed,
        author: isAdmin ? "Admin" : "Teacher / EA",
        createdAt: new Date().toISOString().slice(0, 10)
      },
      ...current
    ]);
    recordAudit("Added note", "Student note", student.student, `Added ${permissionLabel(permission)} note for this student.`);
  }

  function editNote(noteId: string, body: string, permission: StudentNotePermission) {
    const existing = notes.find((note) => note.id === noteId);
    if (!existing || !canMutateStudentNote(existing, currentUserRole) || !canCreateStudentNote(permission, currentUserRole)) return;
    const student = authorizedRows.find((row) => row.id === existing.studentId);
    if (!student) return;
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
    if (!existing || !canMutateStudentNote(existing, currentUserRole)) return;
    const student = authorizedRows.find((row) => row.id === existing.studentId);
    if (!student) return;
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
    setOverviewStudentFilterId(null);
    markUnsaved(`${nextYear} was added. Save to update Firebase.`);
    recordAudit("Created school year", "Overview", nextYear, "Created a new empty school year with no homeroom assignments.");
  }

  function deleteSchoolYear(yearToDelete: string) {
    if (!isAdmin) return;
    if (lockedOverviewYears.includes(yearToDelete)) {
      window.alert(`Unlock ${yearToDelete} before deleting it.`);
      return;
    }
    if (schoolYears.length <= 1) {
      window.alert("At least one school year must remain.");
      return;
    }

    const placementCount = overviewPlacements.filter((placement) => placement.schoolYear === yearToDelete).length;
    const confirmed = window.confirm(
      `Delete ${yearToDelete}? This permanently removes ${placementCount} student placement${placementCount === 1 ? "" : "s"} and all assessment values saved for that year. Student records and other school years will remain.`
    );
    if (!confirmed) return;

    const result = deleteSchoolYearFromOverview({
      rows: orfRows,
      placements: overviewPlacements,
      schoolYears,
      lockedYears: lockedOverviewYears,
      selectedYear: selectedOverviewYear,
      yearToDelete
    });
    if (result.status !== "deleted") return;

    setOrfRows(result.rows);
    setOverviewPlacements(result.placements);
    setDatabaseStudentOptions(buildStudentIdentityOptions(result.rows, result.placements));
    setSchoolYears(result.schoolYears);
    setLockedOverviewYears(result.lockedYears);
    setSelectedOverviewYear(result.selectedYear);
    setOverviewStudentFilterId(null);
    setOverviewDuplicateConflicts([]);
    setOverviewChangedStudentIds(new Set());
    setOverviewDialog(null);
    setImportLogs((current) => current.filter((log) => log.schoolYear !== yearToDelete));
    markUnsaved(`${yearToDelete} was deleted. Save to update Firebase.`);
    recordAudit(
      "Deleted school year",
      "Overview",
      yearToDelete,
      `Deleted the unlocked school year, ${placementCount} student placement${placementCount === 1 ? "" : "s"}, and its scoped assessment values.`
    );
  }

  function addHomeroomWithStudents(homeroom: string, studentCount: number) {
    const trimmedHomeroom = homeroom.trim();
    if (!trimmedHomeroom || !Number.isSafeInteger(studentCount) || studentCount < 1 || studentCount > 40) return;

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
    setOverviewChangedStudentIds((current) => new Set([...current, ...createdRows.map((row) => row.id)]));
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
    if (!student) return;
    const result = moveStudentToExistingHomeroom({
      placements: overviewPlacements,
      studentId,
      schoolYear: selectedOverviewYear,
      grade: selectedOverviewGrade,
      homeroom
    });
    if (result.status !== "moved") {
      if (result.reason === "missing-homeroom") window.alert("Choose a homeroom that already exists in this grade.");
      return;
    }

    setOverviewPlacements(result.placements);
    setOverviewDialog(null);
    setOverviewChangedStudentIds((current) => new Set([...current, studentId]));
    markUnsaved("Student moved. Save to keep the table changes.");
    recordAudit("Moved student", "Overview placement", student.student, `Moved student to ${homeroom.trim()}.`);
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
    setOverviewStudentFilterId((current) => (current === studentId ? null : current));
    setOverviewChangedStudentIds((current) => new Set([...current, studentId]));
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

  function readdExistingStudent(placeholderId: string, existingStudentId: string) {
    const existingStudent = orfRows.find((row) => row.id === existingStudentId);
    const result = reassignPlaceholderToExistingStudent({
      rows: orfRows,
      placements: overviewPlacements,
      placeholderId,
      existingStudentId,
      schoolYear: selectedOverviewYear,
      grade: selectedOverviewGrade
    });
    if (result.status !== "reassigned") {
      if (result.reason === "already-placed") {
        window.alert(`${existingStudent?.student ?? "This student"} is already assigned in ${selectedOverviewYear}.`);
      }
      return;
    }

    setOrfRows(result.rows);
    setOverviewPlacements(result.placements);
    setOverviewDuplicateConflicts((current) => current.filter((conflict) => conflict.studentId !== placeholderId));
    setOverviewChangedStudentIds((current) => new Set([...current, existingStudentId]));
    markUnsaved("Existing student restored with prior assessment history. Save to update Firebase.");
    recordAudit(
      "Restored student placement",
      "Overview placement",
      existingStudent?.student ?? existingStudentId,
      `Re-added the existing student to ${selectedOverviewYear}, Grade ${selectedOverviewGrade}, with prior assessment history intact.`
    );
  }

  async function importOverviewSpreadsheet({ file, schoolYear, grade }: OverviewImportRequest): Promise<OverviewImportResult> {
    if (!canImportOverviewYear(schoolYear, lockedOverviewYears)) {
      throw new Error(`Import is disabled because ${schoolYear} is locked. Unlock the year before importing.`);
    }
    const parsed = await parseStudentImportFile(file, templates);
    const importId = `import-${Date.now()}`;
    const importedAt = new Date().toISOString();
    const existingRowsByName = new Map(orfRows.map((row) => [normalizedImportLabel(row.student), row]));
    const existingNamesForYear = new Set(
      overviewPlacements
        .filter((placement) => placement.schoolYear === schoolYear)
        .map((placement) => {
          const row = orfRows.find((candidate) => candidate.id === placement.studentId);
          return row ? normalizedImportLabel(row.student) : "";
        })
        .filter(Boolean)
    );
    const importedNamesForYear = new Set<string>();
    const duplicateNames: string[] = [];
    const addedStudentIds: string[] = [];
    const addedPlacements: StudentPlacement[] = [];
    const updatedRows: ImportUpdatedRowSnapshot[] = [];
    const validationErrors: string[] = [];
    let dataCellCount = 0;
    const nextRowsById = new Map(orfRows.map((row) => [row.id, row]));

    for (const importedStudent of parsed.students) {
      const normalizedName = normalizedImportLabel(importedStudent.studentName);
      if (existingNamesForYear.has(normalizedName) || importedNamesForYear.has(normalizedName)) {
        duplicateNames.push(importedStudent.studentName);
        continue;
      }
      importedNamesForYear.add(normalizedName);

      const existingRow = existingRowsByName.get(normalizedName);
      const baseRow =
        existingRow ??
        hydrateOrfRow({
          id: `student-${Date.now()}-${addedStudentIds.length + 1}`,
          homeroom: importedStudent.homeroom,
          student: importedStudent.studentName,
          assessmentValues: {},
          septP1Wpm: null,
          septP1Epm: null,
          septP2Wpm: null,
          septP2Epm: null,
          septP3Wpm: null,
          septP3Epm: null
        });
      let nextRow: OrfResultRow = {
        ...baseRow,
        student: importedStudent.studentName,
        homeroom: importedStudent.homeroom,
        assessmentValues: { ...(baseRow.assessmentValues ?? {}) }
      };

      const assessmentImport = applySpreadsheetAssessmentValues(nextRow, importedStudent.values, { schoolYear, grade });
      nextRow = assessmentImport.row;
      dataCellCount += assessmentImport.importedValueCount;
      validationErrors.push(
        ...assessmentImport.validationErrors.map(
          (error) => `row ${importedStudent.sourceRowNumber} (${importedStudent.studentName}): ${error}`
        )
      );

      nextRowsById.set(nextRow.id, nextRow);
      if (!existingRow) addedStudentIds.push(nextRow.id);
      if (existingRow && JSON.stringify(existingRow) !== JSON.stringify(nextRow)) {
        updatedRows.push({ studentId: nextRow.id, previousRow: existingRow, nextRow });
      }

      addedPlacements.push({
        studentId: nextRow.id,
        schoolYear,
        grade,
        homeroom: importedStudent.homeroom
      });
    }

    if (validationErrors.length) {
      const preview = validationErrors.slice(0, 5).join(" ");
      const remainder = validationErrors.length > 5 ? ` ${validationErrors.length - 5} more invalid value(s) were found.` : "";
      throw new Error(`Import stopped before saving because ${validationErrors.length} value(s) are invalid. ${preview}${remainder}`);
    }

    const nextRows = Array.from(nextRowsById.values());
    const nextPlacements = [...overviewPlacements, ...addedPlacements];
    const nextYears = schoolYears.includes(schoolYear) ? schoolYears : [schoolYear, ...schoolYears].sort(compareSchoolYears).reverse();
    const importLog: ImportChangeLog = {
      id: importId,
      fileName: file.name,
      schoolYear,
      grade,
      createdAt: importedAt,
      importedCount: addedPlacements.length,
      dataCellCount,
      duplicateNames: uniqueIds(duplicateNames),
      addedStudentIds,
      addedRows: nextRows.filter((row) => addedStudentIds.includes(row.id)),
      addedPlacements,
      updatedRows
    };
    const nextImportLogs = [importLog, ...importLogs];
    const persistedWorkspaceState: SavedWorkspaceState = {
      rows: nextRows,
      placements: nextPlacements,
      templates,
      schoolYears: nextYears,
      lockedOverviewYears,
      auditEvents,
      importLogs: nextImportLogs,
      pendingStudentSync: true
    };

    await savePrototypeWorkspaceState(persistedWorkspaceState);
    let sqlSyncPending = false;
    let sqlSyncError = "";
    let committedWorkspaceState = persistedWorkspaceState;
    try {
      await saveStudentsToDatabase(nextRows);
      const synchronizedWorkspaceState = { ...persistedWorkspaceState, pendingStudentSync: false };
      await savePrototypeWorkspaceState(synchronizedWorkspaceState);
      committedWorkspaceState = synchronizedWorkspaceState;
    } catch (error) {
      sqlSyncPending = true;
      sqlSyncError = error instanceof Error ? error.message : "Firebase Data Connect could not be synchronized.";
    }
    const auditEvent = createAuditEvent(
      "Imported spreadsheet",
      "Overview import",
      `${schoolYear} / Grade ${grade}`,
      sqlSyncPending
        ? `Saved ${addedPlacements.length} imported student placement${addedPlacements.length === 1 ? "" : "s"} from ${file.name}; SQL synchronization is pending and will retry on reload.`
        : `Imported ${addedPlacements.length} student${addedPlacements.length === 1 ? "" : "s"} from ${file.name}. ${duplicateNames.length} duplicate${duplicateNames.length === 1 ? "" : "s"} skipped.`,
      { importLogId: importId, id: `audit-import-${importId}` }
    );
    const savedAuditEvent = await persistAuditEvent(auditEvent);
    const nextAuditEvents = savedAuditEvent ? mergeAuditEvents([savedAuditEvent], auditEvents) : auditEvents;
    const workspaceState: SavedWorkspaceState = {
      ...committedWorkspaceState,
      auditEvents: nextAuditEvents
    };
    setOrfRows(nextRows);
    setOverviewPlacements(nextPlacements);
    setSchoolYears(nextYears);
    setSelectedOverviewYear(schoolYear);
    setSelectedOverviewGrade(grade);
    setImportLogs(nextImportLogs);
    setAuditEvents((current) => mergeAuditEvents(nextAuditEvents, current));
    setLastSavedWorkspaceState(workspaceState);
    setDatabaseStudentOptions(buildStudentIdentityOptions(nextRows, nextPlacements));
    setOverviewChangedStudentIds(new Set());
    setOverviewDuplicateConflicts([]);
    setSaveStatus(sqlSyncPending ? "error" : "saved");
    setSaveMessage(
      sqlSyncPending
        ? `Import saved to the workspace, but SQL synchronization is pending and will retry on reload. ${sqlSyncError}`
        : savedAuditEvent
        ? `Import complete. ${addedPlacements.length} student${addedPlacements.length === 1 ? "" : "s"} imported and saved to Firebase.`
        : `Import complete, but the shared audit entry could not be saved. Retry the audit from the Audit Log before relying on the record.`
    );

    return {
      importLogId: importId,
      fileName: file.name,
      schoolYear,
      grade,
      importedCount: addedPlacements.length,
      dataCellCount,
      auditSaved: Boolean(savedAuditEvent),
      sqlSyncPending,
      duplicateNames: uniqueIds(duplicateNames)
    };
  }

  async function revertImport(importLogId: string): Promise<ImportRevertOutcome> {
    if (revertingImportIdsRef.current.has(importLogId)) return "unavailable";
    const importLog = importLogs.find((log) => log.id === importLogId);
    if (!importLog || importLog.revertedAt) return "unavailable";
    if (!window.confirm(`Revert the import from ${importLog.fileName}? This will remove imported placements and restore changed assessment values.`)) return "cancelled";

    revertingImportIdsRef.current.add(importLogId);
    try {
      if (!isAdmin) throw new Error("Only an Admin can revert a spreadsheet import.");
      const revertAuditEvent = createAuditEvent(
        "Reverted import",
        "Overview import",
        `${importLog.schoolYear} / Grade ${importLog.grade}`,
        `Reverted imported students and assessment values from ${importLog.fileName}.`,
        { importLogId, id: `audit-revert-${importLogId}` }
      );
      const rollback = await revertSpreadsheetImport(importLogId);
      const workspaceState = rollback.state as SavedWorkspaceState;
      const revertedImportLog = workspaceState.importLogs?.find((log) => log.id === importLogId);
      const revertedAt = revertedImportLog?.revertedAt ?? new Date().toISOString();
      const savedAuditEvent = rollback.event ?? (await persistAuditEvent(revertAuditEvent));
      const nextAuditEvents = mergeAuditEvents(
        auditEvents.map((event) => (event.importLogId === importLogId ? { ...event, revertedAt } : event)),
        savedAuditEvent ? [savedAuditEvent] : []
      );
      setOrfRows(workspaceState.rows);
      setOverviewPlacements(workspaceState.placements);
      setTemplates(workspaceState.templates);
      setSchoolYears(workspaceState.schoolYears);
      setLockedOverviewYears(workspaceState.lockedOverviewYears ?? []);
      setImportLogs(workspaceState.importLogs ?? []);
      setAuditEvents((current) => mergeAuditEvents(nextAuditEvents, current));
      setLastSavedWorkspaceState({ ...workspaceState, auditEvents: nextAuditEvents });
      setDatabaseStudentOptions(buildStudentIdentityOptions(workspaceState.rows, workspaceState.placements));
      setOverviewChangedStudentIds(new Set());
      setSaveStatus("saved");
      setSaveMessage(
        savedAuditEvent
          ? `Reverted import from ${importLog.fileName} and saved the rollback to Firebase.`
          : `Import data was reverted, but the shared audit entry could not be saved. Retry the audit before relying on the record.`
      );
      return savedAuditEvent ? "reverted" : "reverted-audit-pending";
    } finally {
      revertingImportIdsRef.current.delete(importLogId);
    }
  }

  function createAuditEvent(
    eventType: string,
    entityType: string,
    entityLabel: string,
    description: string,
    options?: { importLogId?: string; id?: string }
  ): AppAuditEvent {
    const createdAt = new Date().toISOString();
    const event: AppAuditEvent = {
      id: options?.id ?? newAuditEventId(),
      eventType,
      entityType,
      entityLabel,
      description,
      createdAt,
      actor: authenticatedActorName(authUser),
      ...(authUser?.uid ? { actorUid: authUser.uid } : {}),
      ...(authUser?.email ? { actorEmail: authUser.email } : {}),
      ...(options?.importLogId ? { importLogId: options.importLogId } : {})
    };

    return event;
  }

  async function persistAuditEvent(event: AppAuditEvent) {
    const authenticatedUid = getAuth(firebaseApp).currentUser?.uid;
    if (!authenticatedUid) return null;
    try {
      const savedEvent = await recordOrganizationAuditEvent({
        id: event.id,
        eventType: event.eventType,
        entityType: event.entityType,
        entityLabel: event.entityLabel,
        description: event.description,
        ...(event.importLogId ? { importLogId: event.importLogId } : {})
      });
      removeAuditEventFromOutbox(authenticatedUid, event.id);
      setPendingAuditEventIds((current) => {
        const next = new Set(current);
        next.delete(event.id);
        return next;
      });
      setAuditEvents((current) => mergeAuditEvents(current, [savedEvent]));
      return savedEvent;
    } catch (error) {
      console.error("Audit event could not be saved to Firestore.", error);
      queueAuditEvent(authenticatedUid, event);
      setPendingAuditEventIds((current) => new Set(current).add(event.id));
      return null;
    }
  }

  async function retryAuditEvent(eventId: string) {
    const event = auditEvents.find((candidate) => candidate.id === eventId);
    if (!event || !pendingAuditEventIds.has(eventId) || retryingAuditEventId) return;
    setRetryingAuditEventId(eventId);
    try {
      await persistAuditEvent(event);
    } finally {
      setRetryingAuditEventId(null);
    }
  }

  function recordAudit(eventType: string, entityType: string, entityLabel: string, description: string, options?: { importLogId?: string; id?: string }) {
    const event = createAuditEvent(eventType, entityType, entityLabel, description, options);
    setAuditEvents((current) => mergeAuditEvents([event], current));
    void persistAuditEvent(event);
    return event.id;
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
    return <AuthScreen invitationHandoffComplete={invitationHandoffComplete} />;
  }

  if (organizationAccess === "uninvited") {
    return <PendingInviteScreen email={authUser.email ?? ""} onSignOut={() => signOut(getAuth(firebaseApp))} />;
  }

  if (organizationAccess !== "active" || navigationReadyForUid !== authUser.uid) {
    return (
      <main className="auth-shell">
        <section className="auth-card panel">
          <p className="eyebrow">Student Evaluations</p>
          <h1>Restoring workspace</h1>
          <p>Loading your last authorized tab.</p>
        </section>
      </main>
    );
  }

  const builderScrollMode = activeView === "assessment" && assessmentPageTab === "builder";
  const appShellClasses = [
    "app-shell",
    builderScrollMode ? "builder-scroll-mode" : "",
    tableFullScreen ? "table-fullscreen-mode" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={appShellClasses}>
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
                selected={builderSelected}
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
                schoolYears={schoolYears}
                definitionYears={builderDefinitionYears}
                setDefinitionYears={(years) =>
                  setBuilderDefinitionYearsByAssessment((current) => ({ ...current, [selectedId]: years }))
                }
                savedDefinitionYears={savedDefinitionYears}
                saveStatus={saveStatus}
                saveMessage={saveMessage}
                onSave={saveAssessmentBuilder}
              />
            ) : (
              <InlineEntryTable
                rows={activeOverviewRows}
                setRows={setOrfRows}
                selected={selectedTableTemplate}
                notes={authorizedNotes}
                schoolYears={schoolYears}
                selectedYear={selectedOverviewYear}
                selectedGrade={selectedOverviewGrade}
                onYearChange={setSelectedOverviewYear}
                onGradeChange={setSelectedOverviewGrade}
                scopeLocked={!isAdmin}
                openNotes={setActiveNoteStudentId}
                recordAudit={recordAudit}
                saveStatus={saveStatus}
                saveMessage={saveMessage}
                onSave={saveTablesToFirebase}
                markUnsaved={markUnsaved}
                fullScreen={tableFullScreen}
                onToggleFullScreen={() => setTableFullScreen((current) => !current)}
              />
            )}
          </section>
        ) : activeView === "overview" ? (
          <VpOverview
            rows={activeOverviewRows}
            templates={overviewTemplatesForYear}
            notes={authorizedNotes}
            schoolYears={schoolYears}
            selectedYear={selectedOverviewYear}
            selectedGrade={selectedOverviewGrade}
            homerooms={overviewHomerooms}
            locked={lockedOverviewYears.includes(selectedOverviewYear)}
            onYearChange={(year) => {
              setSelectedOverviewYear(year);
              setOverviewStudentFilterId(null);
            }}
            onGradeChange={(grade) => {
              setSelectedOverviewGrade(grade);
              setOverviewStudentFilterId(null);
            }}
            onAddYear={addSchoolYear}
            onDeleteYear={() => deleteSchoolYear(selectedOverviewYear)}
            onOpenImport={() => {
              if (!canImportOverviewYear(selectedOverviewYear, lockedOverviewYears)) return;
              setOverviewDialog({ type: "import" });
            }}
            onOpenAdd={() => setOverviewDialog({ type: "add" })}
            onMoveStudent={(studentId) => setOverviewDialog({ type: "move", studentId })}
            onDeleteStudent={(studentId) => setOverviewDialog({ type: "delete", studentId })}
            duplicateConflicts={overviewDuplicateConflicts}
            studentOptions={databaseStudentOptions}
            studentSearchOptions={overviewStudentSearchOptions}
            selectedStudentId={overviewStudentFilterId}
            onSelectExistingStudent={readdExistingStudent}
            onStudentSearchSelect={(option) => {
              setSelectedOverviewYear(option.schoolYear);
              setSelectedOverviewGrade(option.grade);
              setOverviewStudentFilterId(option.studentId);
            }}
            onClearStudentSearch={() => setOverviewStudentFilterId(null)}
            onStudentNameChange={(studentId, studentName) => {
              setOrfRows((current) =>
                current.map((row) => (row.id === studentId ? { ...row, student: studentName } : row))
              );
              setOverviewDuplicateConflicts((current) => current.filter((conflict) => conflict.studentId !== studentId));
              setOverviewChangedStudentIds((current) => new Set([...current, studentId]));
              markUnsaved("Student name changed. Save to update Firebase.");
              recordAudit("Edited student name", "Student", studentId, `Changed student display name to ${studentName}.`);
            }}
            openNotes={setActiveNoteStudentId}
            saveStatus={saveStatus}
            saveMessage={saveMessage}
            onSave={saveTablesToFirebase}
            fullScreen={tableFullScreen}
            onToggleFullScreen={() => setTableFullScreen((current) => !current)}
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
          <Dashboard rows={authorizedRows} placements={authorizedPlacements} templates={templates} schoolYears={isAdmin ? schoolYears : [selectedOverviewYear]} />
        ) : activeView === "report" ? (
          <StudentReport
            rows={authorizedRows}
            placements={authorizedPlacements}
            templates={templates}
            schoolYears={isAdmin ? schoolYears : [selectedOverviewYear]}
            recordAudit={recordAudit}
          />
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
            teamMembers={teamMembers}
            onAccessChange={changeTeamMemberAccess}
            assignmentHomerooms={assignmentHomerooms}
            onDeleteMember={deleteTeamMember}
            events={auditEvents}
            pendingAuditEventIds={pendingAuditEventIds}
            retryingAuditEventId={retryingAuditEventId}
            onRetryAuditEvent={retryAuditEvent}
            importLogs={importLogs}
            onRevertImport={revertImport}
            authUser={authUser}
            openInvite={() => setInviteDialogOpen(true)}
            markUnsaved={markUnsaved}
            saveStatus={saveStatus}
            saveMessage={saveMessage}
            onSave={saveTablesToFirebase}
          />
        ) : (
          <Dashboard rows={authorizedRows} placements={authorizedPlacements} templates={templates} schoolYears={isAdmin ? schoolYears : [selectedOverviewYear]} />
        )}
      </section>

      {activeNoteStudent ? (
        <StudentNotesModal
          key={`${activeNoteStudent.id}:${currentUserRole}`}
          student={activeNoteStudent}
          notes={authorizedNotes.filter((note) => note.studentId === activeNoteStudent.id)}
          isAdmin={isAdmin}
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

      {overviewDialog?.type === "import" ? (
        <OverviewImportModal
          currentYear={selectedOverviewYear}
          currentGrade={selectedOverviewGrade}
          lockedYears={lockedOverviewYears}
          onClose={() => setOverviewDialog(null)}
          onImport={importOverviewSpreadsheet}
          onRevert={revertImport}
        />
      ) : null}

      {overviewDialog?.type === "move" ? (
        <MoveStudentModal
          student={activeOverviewRows.find((row) => row.id === overviewDialog.studentId) ?? null}
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
          onInvite={async (invite) => {
            const member = await inviteOrganizationMember(invite);
            setTeamMembers((current) => [
              ...current.filter((item) => item.id !== member.id),
              member
            ].sort((first, second) => first.name.localeCompare(second.name)));
            recordAudit("Invited team member", "Team", member.email, `Invited as ${member.role}.`);
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

type ImportUpdatedRowSnapshot = {
  studentId: string;
  previousRow: OrfResultRow;
  nextRow: OrfResultRow;
};

type ImportChangeLog = {
  id: string;
  fileName: string;
  schoolYear: string;
  grade: string;
  createdAt: string;
  importedCount: number;
  dataCellCount: number;
      duplicateNames: string[];
      addedStudentIds: string[];
      addedRows?: OrfResultRow[];
      addedPlacements: StudentPlacement[];
  updatedRows: ImportUpdatedRowSnapshot[];
  revertedAt?: string;
};

type OverviewImportRequest = {
  file: File;
  schoolYear: string;
  grade: string;
};

type OverviewImportResult = {
  importLogId: string;
  fileName: string;
  schoolYear: string;
  grade: string;
  importedCount: number;
  dataCellCount: number;
  auditSaved: boolean;
  sqlSyncPending: boolean;
  duplicateNames: string[];
};

type SavedWorkspaceState = WorkspaceStudentSnapshot & {
  templates: AssessmentTemplate[];
  schoolYears: string[];
  lockedOverviewYears?: string[];
  pendingStudentSync?: boolean;
  userProfile?: {
    name: string;
    email: string;
    grade: string;
    homeroom: string;
  };
  auditEvents?: AppAuditEvent[];
  importLogs?: ImportChangeLog[];
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

function AuthScreen({ invitationHandoffComplete }: { invitationHandoffComplete: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [action, setAction] = useState<"signin" | "reset" | null>(null);

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAction("signin");
    setAuthMessage("");

    try {
      await signInWithEmailAndPassword(getAuth(firebaseApp), email.trim(), password);
    } catch (error) {
      setAuthMessage(friendlyAuthError(error));
    } finally {
      setAction(null);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setAuthMessage("Enter your invited email address first.");
      return;
    }

    setAction("reset");
    setAuthMessage("");
    try {
      await sendPasswordResetEmail(getAuth(firebaseApp), email.trim());
      setAuthMessage("If that invited account exists, Firebase has sent a password reset email.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setAuthMessage(
        message.includes("auth/operation-not-allowed")
          ? "Email/password sign-in is not enabled in Firebase yet."
          : "If that invited account exists, Firebase has sent a password reset email."
      );
    } finally {
      setAction(null);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel">
        <div>
          <p className="eyebrow">Student Evaluations</p>
          <h1>Sign in</h1>
          <p>Accounts are created by an administrator. Use the email address from your invitation.</p>
        </div>

        {invitationHandoffComplete ? (
          <div className="auth-message">
            Your password is set. The previous account was signed out; sign in with your new credentials.
          </div>
        ) : null}

        <form className="auth-form" onSubmit={submitAuth}>
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
              autoComplete="current-password"
              minLength={6}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
            />
          </label>

          {authMessage ? <div className="auth-message">{authMessage}</div> : null}

          <button className="primary-action" disabled={action !== null} type="submit">
            {action === "signin" ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <button
          className="auth-switch"
          disabled={action !== null}
          onClick={resetPassword}
          type="button"
        >
          {action === "reset" ? "Sending reset email..." : "Forgot password?"}
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
        <h1>Invitation required</h1>
        <p>
          This account is not a member of the organization. An Admin can invite you and assign your access.
        </p>
        <p className="pending-email">{email}</p>
        <button className="primary-action" onClick={onSignOut} type="button">
          Sign out
        </button>
      </section>
    </main>
  );
}

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("auth/invalid-credential")) return "That email and password did not match an account.";
  if (message.includes("auth/email-already-in-use")) return "That email already has an account. Try signing in.";
  if (message.includes("auth/weak-password")) return "Use a password with at least 6 characters.";
  if (message.includes("auth/operation-not-allowed")) return "Email/password sign-in is not enabled in Firebase yet.";
  return message || "Something went wrong with sign-in.";
}

function isRemovedAuthSession(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return [
    "auth/user-not-found",
    "auth/user-disabled",
    "auth/user-token-expired",
    "auth/invalid-user-token"
  ].some((code) => message.includes(code));
}

function friendlyCallableError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("permission-denied")) return "Only an Admin can manage organization users.";
  if (message.includes("already-exists")) return "That email already belongs to this organization.";
  if (message.includes("last Admin")) return "The last Admin cannot be deleted. Assign another Admin first.";
  if (message.includes("not-found")) return "That user is no longer part of this organization.";
  if (message.includes("unavailable")) {
    return "The organization service is temporarily unavailable. Try again.";
  }
  if (message.includes("functions/internal") || /\bINTERNAL\b/.test(message)) {
    return "Firebase could not save the team access change. Try again or refresh the Team list.";
  }
  return message.replace(/^Firebase:\s*/i, "") || "The request could not be completed.";
}

function friendlyPasswordError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("auth/invalid-credential")) return "The current password did not match.";
  if (message.includes("auth/requires-recent-login")) return "Please sign out, sign back in, and try changing your password again.";
  if (message.includes("auth/weak-password")) return "Use a password with at least 6 characters.";
  return message || "Password change failed.";
}

function assessmentDefinitionSnapshot(template: AssessmentTemplate): AssessmentDefinitionSnapshot {
  return {
    name: template.name,
    description: template.description,
    gradeScope: template.gradeScope,
    rounds: template.rounds.map((round) => ({ ...round })),
    sections: (template.sections ?? []).map((section) => ({ ...section, roundIds: [...section.roundIds] })),
    fields: template.fields.map((field) => ({
      ...field,
      roundIds: field.roundIds ? [...field.roundIds] : undefined,
      sectionIds: field.sectionIds ? [...field.sectionIds] : undefined
    }))
  };
}

function assessmentTemplateFromSnapshot(
  template: AssessmentTemplate,
  snapshot: AssessmentDefinitionSnapshot,
  definitionYears = template.definitionYears
): AssessmentTemplate {
  return {
    ...template,
    ...snapshot,
    definitionYears,
    yearDefinitions: template.yearDefinitions,
    rounds: snapshot.rounds.map((round) => ({ ...round })),
    sections: (snapshot.sections ?? []).map((section) => ({ ...section, roundIds: [...section.roundIds] })),
    fields: snapshot.fields.map((field) => ({
      ...field,
      roundIds: field.roundIds ? [...field.roundIds] : undefined,
      sectionIds: field.sectionIds ? [...field.sectionIds] : undefined
    }))
  };
}

function assessmentTemplateForYear(template: AssessmentTemplate, schoolYear: string): AssessmentTemplate {
  const snapshot = template.yearDefinitions?.[schoolYear];
  return snapshot ? assessmentTemplateFromSnapshot(template, snapshot, [schoolYear]) : { ...template, definitionYears: template.definitionYears };
}

function assessmentTemplateForDefinitionScope(
  template: AssessmentTemplate,
  definitionYears: string[],
  schoolYears: string[]
): AssessmentTemplate {
  const fallbackYear = definitionYears[0] ?? schoolYears[0] ?? "";
  const scoped = definitionYears.length === schoolYears.length ? template : assessmentTemplateForYear(template, fallbackYear);
  return { ...scoped, definitionYears, yearDefinitions: template.yearDefinitions };
}

function updateAssessmentTemplateForYears(
  template: AssessmentTemplate,
  definitionYears: string[],
  schoolYears: string[],
  patch: Partial<AssessmentTemplate>
): AssessmentTemplate {
  const scopedYears = definitionYears.length ? definitionYears : schoolYears;

  if (scopedYears.length === schoolYears.length) {
    const updated = { ...template, ...patch, definitionYears: schoolYears };
    const snapshot = assessmentDefinitionSnapshot(updated);
    return {
      ...updated,
      yearDefinitions: Object.fromEntries(schoolYears.map((year) => [year, snapshot]))
    };
  }

  const yearDefinitions = { ...(template.yearDefinitions ?? {}) };
  scopedYears.forEach((year) => {
    const currentSnapshot = assessmentDefinitionSnapshot(assessmentTemplateForYear(template, year));
    yearDefinitions[year] = {
      ...currentSnapshot,
      ...definitionPatchSnapshot(patch)
    };
  });

  return {
    ...template,
    definitionYears: scopedYears,
    yearDefinitions
  };
}

function definitionPatchSnapshot(patch: Partial<AssessmentTemplate>): Partial<AssessmentDefinitionSnapshot> {
  const snapshotPatch: Partial<AssessmentDefinitionSnapshot> = {};
  if (typeof patch.name !== "undefined") snapshotPatch.name = patch.name;
  if (typeof patch.description !== "undefined") snapshotPatch.description = patch.description;
  if (typeof patch.gradeScope !== "undefined") snapshotPatch.gradeScope = patch.gradeScope;
  if (typeof patch.rounds !== "undefined") snapshotPatch.rounds = patch.rounds;
  if (typeof patch.sections !== "undefined") snapshotPatch.sections = patch.sections;
  if (typeof patch.fields !== "undefined") snapshotPatch.fields = patch.fields;
  return snapshotPatch;
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
  schoolYears,
  definitionYears,
  setDefinitionYears,
  savedDefinitionYears,
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
  schoolYears: string[];
  definitionYears: string[];
  setDefinitionYears: (years: string[]) => void;
  savedDefinitionYears: string[];
  saveStatus: SaveStatus;
  saveMessage: string;
  onSave: (definitionYears: string[]) => Promise<void>;
}) {
  const [colorPickerRoundId, setColorPickerRoundId] = useState<string | null>(null);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [sectionWindowPickerId, setSectionWindowPickerId] = useState<string | null>(null);
  const [definitionYearPickerOpen, setDefinitionYearPickerOpen] = useState(false);
  const [overwriteYears, setOverwriteYears] = useState<string[] | null>(null);
  const colorPickerRound = colorPickerRoundId
    ? selected.rounds.find((round) => round.id === colorPickerRoundId) ?? null
    : null;
  const editingField = editingFieldId ? selected.fields.find((field) => field.id === editingFieldId) ?? null : null;
  const sectionWindowPicker = sectionWindowPickerId
    ? (selected.sections ?? []).find((section) => section.id === sectionWindowPickerId) ?? null
    : null;
  const definitionYearLabel =
    definitionYears.length === schoolYears.length
      ? "All years"
      : definitionYears.length === 1
        ? definitionYears[0]
        : definitionYears.length
          ? `${definitionYears.length} years`
          : "No years";

  useEffect(() => {
    setDefinitionYearPickerOpen(false);
    setOverwriteYears(null);
  }, [selected.id]);

  function toggleDefinitionYear(year: string) {
    setDefinitionYears(definitionYears.includes(year) ? definitionYears.filter((item) => item !== year) : [...definitionYears, year]);
  }

  async function saveDefinition() {
    const alreadyDefinedYears = definitionYears.filter((year) => savedDefinitionYears.includes(year));
    if (alreadyDefinedYears.length) {
      setOverwriteYears(alreadyDefinedYears);
      return;
    }
    await onSave(definitionYears);
  }

  async function confirmDefinitionOverwrite() {
    await onSave(definitionYears);
    setOverwriteYears(null);
  }

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
      calculationKey: safeCalculationKey(field.calculationKey),
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
              calculationExpression: undefined,
              letterRanks: draftField.dataType === "letter" || draftField.dataType === "text" ? draftField.letterRanks : undefined,
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
        <SaveBar status={saveStatus} message={saveMessage} onSave={saveDefinition} compact />
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

        <div className="multi-picker">
          <span>Definition years</span>
          <button className="picker-field-button" onClick={() => setDefinitionYearPickerOpen((open) => !open)} type="button">
            <span>{definitionYearLabel}</span>
            <span className="dropdown-arrow" aria-hidden="true" />
          </button>
          {definitionYearPickerOpen ? (
            <div className="multi-picker-menu">
              <label className="checkbox-row select-all-row">
                <input
                  checked={definitionYears.length === schoolYears.length}
                  onChange={() => {
                    setDefinitionYears(definitionYears.length === schoolYears.length ? [] : schoolYears);
                  }}
                  type="checkbox"
                />
                Select All
              </label>
              {schoolYears.map((year) => (
                <label className="checkbox-row" key={year}>
                  <input checked={definitionYears.includes(year)} onChange={() => toggleDefinitionYear(year)} type="checkbox" />
                  {year}
                </label>
              ))}
            </div>
          ) : null}
        </div>

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
                {field.isCalculated ? <span className="formula-pill">{calculationLabel(field.calculationKey)}</span> : null}
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

      {overwriteYears ? (
        <div className="modal-backdrop nested-modal" role="dialog" aria-modal="true" aria-label="Overwrite assessment definition years">
          <section className="notes-modal panel">
            <div className="modal-top">
              <div>
                <p className="eyebrow">Definition Years</p>
                <h2>Overwrite existing years?</h2>
              </div>
              <button className="small-action ghost" onClick={() => setOverwriteYears(null)} type="button">
                Cancel
              </button>
            </div>
            <p>These years already have a definition assigned for {selected.name}:</p>
            <div className="option-checks">
              {overwriteYears.map((year) => (
                <span className="status-badge" key={year}>{year}</span>
              ))}
            </div>
            <p>Overwrite the assessment definition for these years with the current Definition, Windows, Sections, and Fields?</p>
            <button className="primary-action" onClick={confirmDefinitionOverwrite} type="button">
              Overwrite selected years
            </button>
          </section>
        </div>
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
  const selectedCalculation =
    predefinedCalculations.find((calculation) => calculation.key === draftField.calculationKey) ?? predefinedCalculations[0];
  const showScaleEditor = (draftField.dataType === "letter" || draftField.dataType === "text") && !draftField.isCalculated;
  const scaleRows = parseScaleRows(draftField.letterRanks);

  function updateScaleRows(rows: ScaleRow[]) {
    setDraftField((field) => ({ ...field, letterRanks: serializeScaleRows(rows) }));
  }

  function updateScaleRow(index: number, key: keyof ScaleRow, value: string) {
    updateScaleRows(scaleRows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  }

  function addScaleRow(afterIndex: number) {
    const nextRows = [...scaleRows];
    nextRows.splice(afterIndex + 1, 0, { title: "", code: "" });
    updateScaleRows(nextRows);
  }

  function removeScaleRow(index: number) {
    const nextRows = scaleRows.filter((_, rowIndex) => rowIndex !== index);
    updateScaleRows(nextRows.length ? nextRows : [{ title: "", code: "" }]);
  }

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
                {predefinedCalculations.map((calculation) => (
                  <option key={calculation.key} value={calculation.key}>
                    {calculation.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="calculation-help">{selectedCalculation.description}</p>
          </div>
        ) : null}

        {showScaleEditor ? (
          <div className="scale-editor">
            <div className="scale-editor-heading">
              <p className="eyebrow">Scale</p>
              <span>Define the labels and stored codes available for this field.</span>
            </div>
            <div className="scale-editor-labels" aria-hidden="true">
              <span>Title</span>
              <span>Code</span>
              <span />
            </div>
            {scaleRows.map((row, index) => (
              <div className="scale-row" key={index}>
                <input
                  aria-label={`Scale title ${index + 1}`}
                  placeholder="Example: At grade level"
                  value={row.title}
                  onChange={(event) => updateScaleRow(index, "title", event.target.value)}
                />
                <input
                  aria-label={`Scale code ${index + 1}`}
                  placeholder="Example: A"
                  value={row.code}
                  onChange={(event) => updateScaleRow(index, "code", event.target.value)}
                />
                <div className="scale-row-actions">
                  <button
                    className="builder-icon-button"
                    onClick={() => removeScaleRow(index)}
                    type="button"
                    aria-label={`Remove scale row ${index + 1}`}
                    title="Remove scale row"
                  >
                    🗑
                  </button>
                  <button
                    className="builder-icon-button"
                    onClick={() => addScaleRow(index)}
                    type="button"
                    aria-label={`Add scale row after ${index + 1}`}
                    title="Add scale row"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
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
  scopeLocked,
  openNotes,
  recordAudit,
  saveStatus,
  saveMessage,
  onSave,
  markUnsaved,
  fullScreen,
  onToggleFullScreen
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
  scopeLocked: boolean;
  openNotes: (studentId: string) => void;
  recordAudit: RecordAudit;
  saveStatus: SaveStatus;
  saveMessage: string;
  onSave: () => Promise<void>;
  markUnsaved: (message?: string) => void;
  fullScreen: boolean;
  onToggleFullScreen: () => void;
}) {
  const assessmentContext = useMemo(
    () => ({ schoolYear: selectedYear, grade: selectedGrade }),
    [selectedGrade, selectedYear]
  );
  const rowData = useMemo(() => buildEntryRows(rows, selected, assessmentContext), [assessmentContext, rows, selected]);
  const scaleSummaries = useMemo(() => scaleSummariesForAssessment(selected), [selected]);
  const [scalePopupOpen, setScalePopupOpen] = useState(false);
  const [defaultValueTarget, setDefaultValueTarget] = useState<DefaultValueTarget | null>(null);
  const openDefaultValuePopup = useCallback((target: DefaultValueTarget) => {
    setDefaultValueTarget(target);
  }, []);
  const columnDefs = useMemo<ColDef<EntryRow>[]>(
    () => [
      { field: "homeroom", headerName: "HR", pinned: "left", width: 90, filter: true },
      { field: "student", headerName: "Student", pinned: "left", width: 130, filter: true },
      noteColumn(notes, openNotes),
      ...selected.rounds.map((round) => ({
        headerName: round.label,
        headerStyle: roundHeaderStyle(round),
        children: columnsForRound(selected, round, [], [], undefined, openDefaultValuePopup, assessmentContext)
      }))
    ],
    [assessmentContext, notes, openDefaultValuePopup, openNotes, selected]
  );

  function applyDefaultValue(target: DefaultValueTarget, rawValue: string): string | null {
    const validation = validateDefaultFieldValue(target.field, rawValue, target.scaleCodes);
    if (!validation.valid) return validation.error;
    const nextValue = validation.value;
    const invalidRow = rows
      .map((row) => ({ row, validation: validateAssessmentTableEdit(row, selected, target.fieldName, nextValue, assessmentContext) }))
      .find((result) => !result.validation.valid);
    if (invalidRow && !invalidRow.validation.valid) {
      return `${invalidRow.row.student}: ${invalidRow.validation.error}`;
    }
    const visibleRowIds = new Set(rows.map((row) => row.id));
    setRows((current) =>
      current.map((row) =>
        visibleRowIds.has(row.id)
          ? updateAssessmentRowFromTableEdit(row, selected, target.fieldName, nextValue, assessmentContext)
          : row
      )
    );
    recordAudit(
      "Applied default value",
      "Assessment result",
      `${selected.name} / ${target.label}`,
      `Set ${target.label} to ${nextValue ?? "-"} for ${rows.length} row${rows.length === 1 ? "" : "s"}.`
    );
    markUnsaved("Assessment table changed. Save to keep the table changes.");
    setDefaultValueTarget(null);
    return null;
  }

  function onCellValueChanged(event: CellValueChangedEvent<EntryRow>) {
    const fieldName = event.column.getColId();
    if (!event.data || !fieldName || event.oldValue === event.newValue) return;
    const sourceRow = rows.find((row) => row.id === event.data?.id);
    if (!sourceRow) return;
    const updatedRow = updateAssessmentRowFromTableEdit(sourceRow, selected, fieldName, event.newValue, assessmentContext);
    if (updatedRow === sourceRow) return;

    // AG Grid commits the current editor before it resolves Tab navigation. Commit
    // React's immutable row update in that same phase so a later render cannot
    // replace the row while the next editor is accepting the user's first digit.
    flushSync(() => {
      setRows((current) =>
        current.map((row) => (row.id === sourceRow.id ? updatedRow : row))
      );
    });

    recordAudit(
      "Edited score",
      "Assessment result",
      `${event.data.student} / ${event.colDef.headerName ?? fieldName}`,
      `Changed ${fieldName} from ${event.oldValue ?? "-"} to ${event.newValue ?? "-"}.`
    );
    markUnsaved("Assessment table changed. Save to keep the table changes.");
  }

  return (
    <section className={fullScreen ? "panel entry-panel table-card-fullscreen" : "panel entry-panel"}>
      <div className="entry-heading">
        <div className="entry-title-block">
          <p className="eyebrow">Assessment Entry</p>
          <h2>{selected.name}</h2>
        </div>

        <div className="entry-filters">
          <button
            className="small-action scale-action"
            disabled={!scaleSummaries.length}
            onClick={() => setScalePopupOpen(true)}
            type="button"
          >
            Scale
          </button>
          <label>
            Year
            <select disabled={scopeLocked} value={selectedYear} onChange={(event) => onYearChange(event.target.value)}>
              {schoolYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grade
            <select disabled={scopeLocked} value={selectedGrade} onChange={(event) => onGradeChange(event.target.value)}>
              {SUPPORTED_GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  Grade {grade}
                </option>
              ))}
            </select>
          </label>
          <button className="small-action fullscreen-action" onClick={onToggleFullScreen} type="button">
            {fullScreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      {scalePopupOpen ? (
        <ScalePopup summaries={scaleSummaries} onClose={() => setScalePopupOpen(false)} />
      ) : null}

      {defaultValueTarget ? (
        <DefaultValuePopup
          target={defaultValueTarget}
          onApply={applyDefaultValue}
          onClose={() => setDefaultValueTarget(null)}
        />
      ) : null}

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
          invalidEditValueMode="revert"
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

type ScaleSummary = {
  fieldName: string;
  rows: ScaleRow[];
};

function ScalePopup({ summaries, onClose }: { summaries: ScaleSummary[]; onClose: () => void }) {
  return (
    <div className="modal-backdrop nested-modal" role="dialog" aria-modal="true" aria-label="Assessment scales">
      <section className="notes-modal panel scale-popup">
        <div className="modal-top">
          <div>
            <p className="eyebrow">Scale</p>
            <h2>Assessment scales</h2>
          </div>
          <button className="small-action ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="table-scale-legend" aria-label="Assessment scale">
          {summaries.map((summary) => (
            <div className="table-scale-group" key={summary.fieldName}>
              <span className="table-scale-field">{summary.fieldName}</span>
              <div className="table-scale-chips">
                {summary.rows.map((row, index) => (
                  <span className="table-scale-chip" key={`${row.title}-${row.code}-${index}`}>
                    {row.title || "Untitled"}
                    {row.code ? <strong>{row.code}</strong> : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DefaultValuePopup({
  target,
  onApply,
  onClose
}: {
  target: DefaultValueTarget;
  onApply: (target: DefaultValueTarget, value: string) => string | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState(target.scaleCodes[0] ?? "");
  const [validationError, setValidationError] = useState("");
  const inputType = target.field.dataType === "integer" || target.field.dataType === "percentage" ? "number" : target.field.dataType === "date" ? "date" : "text";

  return (
    <div className="modal-backdrop nested-modal" role="dialog" aria-modal="true" aria-label="Default column value">
      <section className="notes-modal panel default-value-popup">
        <div className="modal-top">
          <div>
            <p className="eyebrow">Default value</p>
            <h2>{target.field.name}</h2>
          </div>
          <button className="small-action ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <p className="default-value-help">Apply one value to every row in this column for the current table.</p>

        <label>
          Value
          {target.scaleCodes.length ? (
            <select value={value} onChange={(event) => setValue(event.target.value)}>
              {target.scaleCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              max={target.field.validationConfig?.max ?? (target.field.dataType === "percentage" ? 100 : undefined)}
              min={target.field.validationConfig?.min ?? (inputType === "number" ? 0 : undefined)}
              step={target.field.dataType === "integer" ? 1 : target.field.dataType === "percentage" ? "any" : undefined}
              type={inputType}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setValidationError("");
              }}
            />
          )}
        </label>

        {validationError ? <p className="form-error" role="alert">{validationError}</p> : null}

        <div className="modal-actions">
          <button className="small-action ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-action"
            onClick={() => setValidationError(onApply(target, value) ?? "")}
            type="button"
          >
            Apply to all rows
          </button>
        </div>
      </section>
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
  onDeleteYear,
  onOpenImport,
  onOpenAdd,
  onMoveStudent,
  onDeleteStudent,
  duplicateConflicts,
  studentOptions,
  studentSearchOptions,
  selectedStudentId,
  onSelectExistingStudent,
  onStudentSearchSelect,
  onClearStudentSearch,
  onStudentNameChange,
  openNotes,
  saveStatus,
  saveMessage,
  onSave,
  fullScreen,
  onToggleFullScreen,
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
  onDeleteYear: () => void;
  onOpenImport: () => void;
  onOpenAdd: () => void;
  onMoveStudent: (studentId: string) => void;
  onDeleteStudent: (studentId: string) => void;
  duplicateConflicts: DuplicateStudentNameConflict[];
  studentOptions: StudentIdentityOption[];
  studentSearchOptions: StudentSearchOption[];
  selectedStudentId: string | null;
  onSelectExistingStudent: (placeholderId: string, existingStudentId: string) => void;
  onStudentSearchSelect: (option: StudentSearchOption) => void;
  onClearStudentSearch: () => void;
  onStudentNameChange: (studentId: string, studentName: string) => void;
  openNotes: (studentId: string) => void;
  saveStatus: SaveStatus;
  saveMessage: string;
  onSave: () => Promise<void>;
  fullScreen: boolean;
  onToggleFullScreen: () => void;
  onLockChange: (locked: boolean) => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [hiddenAssessmentIds, setHiddenAssessmentIds] = useState<string[]>([]);
  const [hiddenRoundIds, setHiddenRoundIds] = useState<string[]>([]);
  const [hiddenSectionIds, setHiddenSectionIds] = useState<string[]>([]);
  const [hiddenFieldIds, setHiddenFieldIds] = useState<string[]>([]);
  const [studentSearchText, setStudentSearchText] = useState("");
  const [studentSearchOpen, setStudentSearchOpen] = useState(false);
  const duplicateStudentIds = useMemo(() => duplicateConflicts.map((conflict) => conflict.studentId), [duplicateConflicts]);
  const matchingStudentOptions = useMemo(() => {
    const query = normalizeStudentName(studentSearchText);
    return studentSearchOptions
      .filter((option) => !query || normalizeStudentName(option.name).includes(query))
      .slice(0, 8);
  }, [studentSearchOptions, studentSearchText]);
  const rowData = useMemo(
    () =>
      buildOverviewRows(
        selectedStudentId ? rows.filter((row) => row.id === selectedStudentId) : rows,
        templates,
        { schoolYear: selectedYear, grade: selectedGrade, cohortRows: rows }
      ),
    [rows, selectedGrade, selectedStudentId, selectedYear, templates]
  );
  const columnDefs = useMemo<ColDef<EntryRow>[]>(
    () => [
      { field: "homeroom", headerName: "HR", pinned: "left", width: 90, filter: true, editable: false, cellClass: "read-only-grid-cell" },
      studentActionColumn(
        onMoveStudent,
        onDeleteStudent,
        onStudentNameChange,
        onSelectExistingStudent,
        locked,
        duplicateStudentIds,
        studentOptions
      ),
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
              children: columnsForRound(template, round, hiddenFieldIds, hiddenSectionIds)
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
      onSelectExistingStudent,
      onStudentNameChange,
      openNotes,
      studentOptions,
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

  function clearStudentSearch() {
    setStudentSearchText("");
    setStudentSearchOpen(false);
    onClearStudentSearch();
  }

  function selectStudentSearchOption(option: StudentSearchOption) {
    if (saveStatus === "dirty" && !window.confirm("You have unsaved table changes. Navigate to another student without saving?")) {
      return;
    }
    setStudentSearchText(option.name);
    setStudentSearchOpen(false);
    onStudentSearchSelect(option);
  }

  function onCellValueChanged(event: CellValueChangedEvent<EntryRow>) {
    if (event.colDef.field === "student" && event.data?.id && event.newValue !== event.oldValue) {
      onStudentNameChange(event.data.id, String(event.newValue ?? ""));
    }
  }

  return (
    <section className={fullScreen ? "overview-panel table-card-fullscreen" : "overview-panel"}>
      <div className="panel overview-table-panel">
        <div className="overview-toolbar">
          <button
            className="small-action"
            disabled={locked}
            onClick={onOpenImport}
            title={locked ? `Unlock ${selectedYear} before importing` : "Import a spreadsheet"}
            type="button"
          >
            Import
          </button>

          <label>
            Year
            <select
              value={selectedYear}
              onChange={(event) => {
                if (saveStatus === "dirty" && !window.confirm("You have unsaved table changes. Change years without saving?")) {
                  event.target.value = selectedYear;
                  return;
                }
                clearStudentSearch();
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
            Add Year
          </button>

          <button
            className="small-action danger-outline-action"
            disabled={locked || schoolYears.length <= 1}
            onClick={onDeleteYear}
            title={locked ? `Unlock ${selectedYear} before deleting it` : schoolYears.length <= 1 ? "At least one school year must remain" : `Delete ${selectedYear}`}
            type="button"
          >
            Delete Year
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
                clearStudentSearch();
                onGradeChange(event.target.value);
              }}
            >
              {SUPPORTED_GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  Grade {grade}
                </option>
              ))}
            </select>
          </label>

          <button className="primary-action toolbar-action" disabled={locked} onClick={onOpenAdd} type="button">
            Add homeroom / students
          </button>

          <div className="overview-toolbar-actions" role="group" aria-label="Overview display actions">
            <button className={locked ? "small-action muted-action" : "small-action"} onClick={toggleLock} type="button">
              {locked ? "Unlock" : "Lock"}
            </button>

            <button className="small-action fullscreen-action" onClick={onToggleFullScreen} type="button">
              {fullScreen ? "Exit full screen" : "Full screen"}
            </button>

            <button className="small-action overview-options-action" onClick={() => setOptionsOpen(true)} type="button">
              Options
            </button>
          </div>
        </div>

        <div className="overview-student-search-row">
          <label className="overview-student-search">
            Find student
            <input
              aria-autocomplete="list"
              aria-controls="overview-student-search-results"
              aria-expanded={studentSearchOpen && matchingStudentOptions.length > 0}
              autoComplete="off"
              placeholder="Search by student name"
              role="combobox"
              value={studentSearchText}
              onBlur={() => setStudentSearchOpen(false)}
              onChange={(event) => {
                setStudentSearchText(event.target.value);
                setStudentSearchOpen(true);
                if (selectedStudentId) onClearStudentSearch();
              }}
              onFocus={() => setStudentSearchOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setStudentSearchOpen(false);
                  return;
                }
                if (event.key === "Enter" && normalizeStudentName(studentSearchText) && matchingStudentOptions[0]) {
                  event.preventDefault();
                  selectStudentSearchOption(matchingStudentOptions[0]);
                }
              }}
            />
          </label>
          {studentSearchOpen && matchingStudentOptions.length ? (
            <div className="overview-student-search-results" id="overview-student-search-results" role="listbox">
              {matchingStudentOptions.map((option) => (
                <button
                  key={option.key}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectStudentSearchOption(option);
                  }}
                  role="option"
                  type="button"
                >
                  <strong>{option.name}</strong>
                  <span>{option.schoolYear} / Grade {option.grade} / {option.homeroom}</span>
                </button>
              ))}
            </div>
          ) : null}
          {selectedStudentId ? (
            <button className="small-action" onClick={clearStudentSearch} type="button">
              Clear student filter
            </button>
          ) : null}
        </div>

        <div className="overview-save-row">
          <SaveBar status={saveStatus} message={saveMessage} onSave={onSave} />
          <div className="entry-status overview-student-count">
            <strong>{rowData.length}</strong>
            <span>{selectedStudentId ? `of ${rows.length} students shown` : "students assigned"}</span>
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

type DashboardProps = {
  rows: OrfResultRow[];
  placements: StudentPlacement[];
  templates: AssessmentTemplate[];
  schoolYears: string[];
};

type DashboardChartPointBase = DashboardChartAxisPoint & {
  sectionLabel: string;
  windowLabel: string;
  sectionLine: number;
  color: string;
  [key: string]: string | number | null;
};

type DashboardChartPoint = DashboardChartPointBase & {
  yearLabel: string;
};

function Dashboard(props: DashboardProps) {
  const nextChartNumber = useRef(2);
  const [chartIds, setChartIds] = useState(["dashboard-chart-1"]);

  function handleAddChart() {
    const chartId = `dashboard-chart-${nextChartNumber.current}`;
    nextChartNumber.current += 1;
    setChartIds((current) => addDashboardChart(current, chartId));
  }

  return (
    <section className="dashboard-layout">
      <div className="dashboard-toolbar">
        <div>
          <p className="eyebrow">Dashboard charts</p>
          <p className="dashboard-toolbar-copy">Add charts to compare different filters side by side.</p>
        </div>
      </div>

      {chartIds.length ? (
        <div className="dashboard-chart-strip" aria-label="Dashboard charts" role="region">
          {chartIds.map((chartId, index) => (
            <DashboardChartCard
              {...props}
              chartId={chartId}
              chartNumber={index + 1}
              canRemove={chartIds.length > 1}
              key={chartId}
              onAdd={handleAddChart}
              onRemove={() => setChartIds((current) => removeDashboardChart(current, chartId))}
              showAdd={index === chartIds.length - 1}
            />
          ))}
        </div>
      ) : (
        <div className="panel dashboard-no-charts">
          <p>No charts are open.</p>
          <button className="small-action" onClick={handleAddChart} type="button">
            Add chart
          </button>
        </div>
      )}
    </section>
  );
}

function DashboardChartCard({
  rows,
  placements,
  templates,
  schoolYears,
  chartId,
  chartNumber,
  canRemove,
  onAdd,
  onRemove,
  showAdd
}: DashboardProps & {
  chartId: string;
  chartNumber: number;
  canRemove: boolean;
  onAdd: () => void;
  onRemove: () => void;
  showAdd: boolean;
}) {
  const [chartType, setChartType] = useState<"progression" | "comparison" | "average">("progression");
  const [homeroom, setHomeroom] = useState("all");
  const [studentKey, setStudentKey] = useState("all");
  const [assessmentIds, setAssessmentIds] = useState<string[]>(templates[0] ? [templates[0].id] : []);
  const selectedAssessments = useMemo(
    () => templates.filter((template) => assessmentIds.includes(template.id)),
    [assessmentIds, templates]
  );
  const selectedAssessment = selectedAssessments[0] ?? templates[0];
  const [fieldKeys, setFieldKeys] = useState<string[]>(templates[0]?.fields[0] ? [`${templates[0].id}::${templates[0].fields[0].id}`] : []);
  const [sectionId, setSectionId] = useState("all");
  const [roundId, setRoundId] = useState("all");
  const [selectedYears, setSelectedYears] = useState<string[]>(schoolYears);
  const [assessmentPickerOpen, setAssessmentPickerOpen] = useState(false);
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [progressionFullScreen, setProgressionFullScreen] = useState(false);
  const [chartWidth, setChartWidth] = useState(1000);
  const allYearsSelected = selectedYears.length === schoolYears.length;
  const allAssessmentsSelected = assessmentIds.length === templates.length;
  const fieldOptions = useMemo(
    () =>
      selectedAssessments.flatMap((assessment) =>
        assessment.fields.map((field) => ({
          id: `${assessment.id}::${field.id}`,
          label: `${assessment.name} / ${field.name}`,
          assessment,
          field
        }))
      ),
    [selectedAssessments]
  );
  const selectedFieldRefs = useMemo(
    () => fieldOptions.filter((option) => fieldKeys.includes(option.id)),
    [fieldKeys, fieldOptions]
  );
  const selectedField = selectedFieldRefs[0]?.field;
  const assessmentPickerLabel = allAssessmentsSelected
    ? "All assessments"
    : assessmentIds.length === 1
      ? templates.find((template) => template.id === assessmentIds[0])?.name ?? "1 assessment"
      : assessmentIds.length
        ? `${assessmentIds.length} assessments`
        : "No assessments";
  const fieldPickerLabel =
    selectedFieldRefs.length === 1
      ? selectedFieldRefs[0].field.name
      : selectedFieldRefs.length
        ? `${selectedFieldRefs.length} fields`
        : "No fields";
  const yearPickerLabel = allYearsSelected
    ? "All Years"
    : selectedYears.length === 1
      ? selectedYears[0]
      : selectedYears.length
        ? `${selectedYears.length} Years`
        : "No Years";

  const selectedYearPlacements = useMemo(
    () => placements.filter((placement) => selectedYears.includes(placement.schoolYear)),
    [placements, selectedYears]
  );
  const dashboardPlacements = useMemo(
    () =>
      selectedYearPlacements.filter((placement) => homeroom === "all" || placement.homeroom === homeroom),
    [homeroom, selectedYearPlacements]
  );
  const homerooms = useMemo(
    () => Array.from(new Set(selectedYearPlacements.map((placement) => placement.homeroom))).sort(),
    [selectedYearPlacements]
  );
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const availableStudents = useMemo(() => {
    const seen = new Set<string>();
    return dashboardPlacements
      .map((placement) => rowsById.get(placement.studentId))
      .filter((row): row is OrfResultRow => {
        if (!row) return false;
        const key = dashboardStudentKey(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((first, second) => first.student.localeCompare(second.student));
  }, [dashboardPlacements, rowsById]);

  useEffect(() => {
    setAssessmentIds((current) => {
      const valid = current.filter((id) => templates.some((template) => template.id === id));
      return valid.length ? valid : templates[0] ? [templates[0].id] : [];
    });
  }, [templates]);

  useEffect(() => {
    setFieldKeys((current) => {
      const valid = current.filter((key) => fieldOptions.some((option) => option.id === key));
      return valid.length ? valid : fieldOptions[0] ? [fieldOptions[0].id] : [];
    });
  }, [fieldOptions]);

  useEffect(() => {
    if (studentKey !== "all" && !availableStudents.some((row) => dashboardStudentKey(row) === studentKey)) {
      setStudentKey("all");
    }
  }, [availableStudents, studentKey]);

  const filteredPlacements = useMemo(
    () =>
      dashboardPlacements.filter((placement) => {
        if (studentKey === "all") return true;
        const row = rowsById.get(placement.studentId);
        return row ? dashboardStudentKey(row) === studentKey : false;
      }),
    [dashboardPlacements, rowsById, studentKey]
  );
  const selectedScaleCodes = useMemo(() => (selectedField ? scaleCodesForField(selectedField) : []), [selectedField]);
  const usesScaleYAxis =
    selectedFieldRefs.length === 1 &&
    selectedScaleCodes.length > 0 &&
    (selectedField?.dataType === "letter" || selectedField?.dataType === "text");
  const availableSections = useMemo(() => {
    if (!selectedFieldRefs.length) return [];
    const sections = new Map<string, AssessmentSectionTemplate>();
    selectedFieldRefs.forEach(({ assessment, field }) => {
      assessment.rounds.forEach((round) => {
        dashboardSectionsForField(assessment, round, field).forEach((section) => {
          sections.set(section.id, section);
        });
      });
    });
    return Array.from(sections.values());
  }, [selectedFieldRefs]);

  useEffect(() => {
    if (sectionId !== "all" && !availableSections.some((section) => section.id === sectionId)) {
      setSectionId("all");
    }
  }, [availableSections, sectionId]);

  useEffect(() => {
    if (roundId !== "all" && !selectedAssessments.some((assessment) => assessment.rounds.some((round) => round.id === roundId))) {
      setRoundId("all");
    }
  }, [roundId, selectedAssessments]);

  const chartData = useMemo(() => {
    if (!selectedFieldRefs.length) return [];
    const pointsByYear = selectedYears
      .slice()
      .sort(compareSchoolYears)
      .flatMap((year) => {
        const points = new Map<
          string,
          DashboardChartPointBase
        >();

        selectedFieldRefs.forEach(({ id, assessment, field }) => {
          const chartPoints = assessment.rounds.reduce<
            Array<{ round: AssessmentRoundTemplate; section?: AssessmentSectionTemplate; sectionIndex: number; sectionCount: number }>
          >((roundPoints, round) => {
            if (roundId !== "all" && round.id !== roundId) return roundPoints;
            const sections = dashboardSectionsForField(assessment, round, field);
            if (sections.length) {
              const filteredSections = sectionId === "all" ? sections : sections.filter((section) => section.id === sectionId);
              filteredSections.forEach((section, sectionIndex) =>
                roundPoints.push({ round, section, sectionIndex, sectionCount: filteredSections.length })
              );
            } else if (sectionId === "all") {
              roundPoints.push({ round, sectionIndex: 0, sectionCount: 0 });
            }
            return roundPoints;
          }, []);

          chartPoints.forEach(({ round, section, sectionIndex, sectionCount }) => {
            const key = `${assessment.id}-${year}-${round.id}-${section?.id ?? "window"}`;
            const showWindowLabel = !section || sectionIndex === Math.floor(sectionCount / 2);
            const existing = points.get(key);
            const basePoint =
              existing ??
              {
                axisKey: key,
                year,
                window: round.label,
                section: section?.name ?? "",
                sectionLabel: section?.name ?? "",
                windowLabel: showWindowLabel ? windowIndicatorForRound(round) : "",
                sectionLine: sectionIndex % 2,
                color: round.color ?? "#101820"
              };
            points.set(key, {
              ...basePoint,
              [id]: averageDashboardFieldValue(filteredPlacements, rowsById, assessment, round, field, year, section)
            });
          });
        });

        return Array.from(points.values());
      });
    return labelDashboardYears(pointsByYear) as DashboardChartPoint[];
  }, [filteredPlacements, rowsById, roundId, sectionId, selectedFieldRefs, selectedYears]);

  const chartPointsByAxisKey = useMemo(
    () => new Map(chartData.map((point) => [point.axisKey, point])),
    [chartData]
  );
  const yearGroups = useMemo(() => dashboardYearGroups(chartData), [chartData]);

  const pieData = useMemo(
    () =>
      selectedFieldRefs
        .map(({ id, label }) => {
          const values = chartData
            .map((point) => point[id])
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
          return {
            name: label,
            value: values.length ? Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10 : 0
          };
        })
        .filter((item) => item.value > 0),
    [chartData, selectedFieldRefs]
  );
  const seriesPalette = ["#101820", "#7868e6", "#0f766e", "#c2410c", "#2563eb", "#be185d", "#6b7280"];
  const chartTitle =
    chartType === "progression"
      ? "Average field score by year and window"
      : chartType === "comparison"
        ? "Field comparison by year and window"
        : "Average selected field values";
  const chartTypeLabel = chartType === "progression" ? "Progression" : chartType === "comparison" ? "Comparison" : "Average";
  const axisLabelCharacterLimit = dashboardAxisLabelCharacterLimit(chartWidth, chartData.length);
  const legendLabelCharacterLimit = dashboardLegendLabelCharacterLimit(chartWidth, selectedFieldRefs.length);

  const handleChartResize = useCallback((width: number) => {
    const nextWidth = Math.max(1, Math.round(width));
    setChartWidth((current) => (current === nextWidth ? current : nextWidth));
  }, []);

  const renderDashboardAxisTick = useCallback(
    (props: DashboardAxisTickProps) => {
      const axisKey = String(props.payload?.value ?? "");
      return (
        <DashboardAxisTick
          {...props}
          labelCharacterLimit={axisLabelCharacterLimit}
          point={chartPointsByAxisKey.get(axisKey)}
        />
      );
    },
    [axisLabelCharacterLimit, chartPointsByAxisKey]
  );

  const renderDashboardLegendLabel = useCallback(
    (value: string | number) => {
      const fullLabel = String(value);
      return (
        <span aria-label={fullLabel} className="dashboard-legend-label" title={fullLabel}>
          {compactDashboardLegendLabel(fullLabel, legendLabelCharacterLimit)}
        </span>
      );
    },
    [legendLabelCharacterLimit]
  );

  function toggleDashboardYear(year: string) {
    setSelectedYears((current) =>
      current.includes(year) ? current.filter((selectedYear) => selectedYear !== year) : [...current, year]
    );
  }

  function toggleDashboardAssessment(id: string) {
    setAssessmentIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return next.length ? next : current;
    });
  }

  function toggleDashboardField(id: string) {
    setFieldKeys((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return next.length ? next : current;
    });
  }

  return (
    <div className="dashboard-chart-workspace" data-dashboard-chart={chartId}>
      <div className="panel dashboard-filters">
        <label>
          Chart type
          <select value={chartType} onChange={(event) => setChartType(event.target.value as "progression" | "comparison" | "average")}>
            <option value="progression">Progression</option>
            <option value="comparison">Comparison</option>
            <option value="average">Average</option>
          </select>
        </label>

        <label>
          Home room
          <select value={homeroom} onChange={(event) => setHomeroom(event.target.value)}>
            <option value="all">All home rooms</option>
            {homerooms.map((room) => (
              <option key={room} value={room}>
                {room}
              </option>
            ))}
          </select>
        </label>

        <label>
          Student
          <select value={studentKey} onChange={(event) => setStudentKey(event.target.value)}>
            <option value="all">All students</option>
            {availableStudents.map((row) => (
              <option key={dashboardStudentKey(row)} value={dashboardStudentKey(row)}>
                {row.student}
              </option>
            ))}
          </select>
        </label>

        <div className="multi-picker">
          <span>Assessment</span>
          <button className="picker-field-button" onClick={() => setAssessmentPickerOpen((open) => !open)} type="button">
            <span>{assessmentPickerLabel}</span>
            <span className="dropdown-arrow" aria-hidden="true" />
          </button>
          {assessmentPickerOpen ? (
            <div className="multi-picker-menu wide">
              <label className="checkbox-row select-all-row">
                <input
                  checked={allAssessmentsSelected}
                  onChange={() =>
                    setAssessmentIds(allAssessmentsSelected ? (templates[0] ? [templates[0].id] : []) : templates.map((template) => template.id))
                  }
                  type="checkbox"
                />
                All assessments
              </label>
              {templates.map((template) => (
                <label className="checkbox-row" key={template.id}>
                  <input checked={assessmentIds.includes(template.id)} onChange={() => toggleDashboardAssessment(template.id)} type="checkbox" />
                  {template.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <div className="multi-picker">
          <span>Field</span>
          <button className="picker-field-button" onClick={() => setFieldPickerOpen((open) => !open)} type="button">
            <span>{fieldPickerLabel}</span>
            <span className="dropdown-arrow" aria-hidden="true" />
          </button>
          {fieldPickerOpen ? (
            <div className="multi-picker-menu wide">
              <label className="checkbox-row select-all-row">
                <input
                  checked={fieldOptions.length > 0 && fieldKeys.length === fieldOptions.length}
                  onChange={() => setFieldKeys(fieldKeys.length === fieldOptions.length ? (fieldOptions[0] ? [fieldOptions[0].id] : []) : fieldOptions.map((option) => option.id))}
                  type="checkbox"
                />
                All fields
              </label>
              {fieldOptions.map((option) => (
                <label className="checkbox-row" key={option.id}>
                  <input checked={fieldKeys.includes(option.id)} onChange={() => toggleDashboardField(option.id)} type="checkbox" />
                  {option.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <label>
          Section
          <select value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
            <option value="all">All sections</option>
            {availableSections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Window
          <select value={roundId} onChange={(event) => setRoundId(event.target.value)}>
            <option value="all">All windows</option>
            {uniqueDashboardRounds(selectedAssessments).map((round) => (
              <option key={round.id} value={round.id}>
                {round.label}
              </option>
            ))}
          </select>
        </label>

        <div className="dashboard-year-picker">
          <span>Year</span>
          <button className="picker-field-button" onClick={() => setYearPickerOpen((open) => !open)} type="button">
            <span>{yearPickerLabel}</span>
            <span className="dropdown-arrow" aria-hidden="true" />
          </button>

          {yearPickerOpen ? (
            <div className="dashboard-year-menu">
              <label className="checkbox-row select-all-row">
                <input
                  checked={allYearsSelected}
                  onChange={() => setSelectedYears(allYearsSelected ? [] : schoolYears)}
                  type="checkbox"
                />
                All Years
              </label>
              {schoolYears.map((schoolYear) => (
                <label className="checkbox-row" key={schoolYear}>
                  <input checked={selectedYears.includes(schoolYear)} onChange={() => toggleDashboardYear(schoolYear)} type="checkbox" />
                  {schoolYear}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className={progressionFullScreen ? "panel chart-panel progression-chart-panel chart-panel-fullscreen" : "panel chart-panel progression-chart-panel"}>
        <div className="panel-heading chart-panel-heading">
          <div>
            <p className="eyebrow">{chartTypeLabel}</p>
            <h2>{chartTitle}</h2>
          </div>
          <button className="small-action ghost" onClick={() => setProgressionFullScreen((current) => !current)} type="button">
            {progressionFullScreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
        <div className="chart-frame">
          {chartType === "average" && !pieData.length ? (
            <div className="dashboard-chart-empty">No values match the selected filters.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" onResize={handleChartResize}>
              {chartType === "progression" ? (
                <LineChart data={chartData} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  {yearGroups.map((group, index) => (
                    <ReferenceArea
                      fill={index % 2 ? "#7868e6" : "#68b39b"}
                      fillOpacity={0.06}
                      key={`progression-area-${group.year}`}
                      strokeOpacity={0}
                      x1={group.firstAxisKey}
                      x2={group.lastAxisKey}
                    />
                  ))}
                  {yearGroups.slice(1).map((group) => (
                    <ReferenceLine
                      key={`progression-boundary-${group.year}`}
                      stroke="#66707c"
                      strokeWidth={2}
                      x={group.firstAxisKey}
                    />
                  ))}
                  <XAxis dataKey="axisKey" height={98} interval={0} tick={renderDashboardAxisTick} tickMargin={12} />
                  {usesScaleYAxis ? (
                    <YAxis
                      allowDecimals={false}
                      domain={[1, selectedScaleCodes.length]}
                      ticks={selectedScaleCodes.map((_, index) => index + 1)}
                      tickFormatter={(value) => selectedScaleCodes[Number(value) - 1] ?? ""}
                      width={48}
                    />
                  ) : (
                    <YAxis allowDecimals={false} />
                  )}
                  <Tooltip
                    formatter={(value) => formatDashboardTooltipValue(value, selectedScaleCodes)}
                    labelFormatter={(_, payload) =>
                      formatDashboardTooltipLabel(payload[0]?.payload as DashboardChartAxisPoint | undefined)
                    }
                  />
                  <Legend formatter={renderDashboardLegendLabel} />
                  {selectedFieldRefs.map((option, index) => (
                    <Line
                      connectNulls
                      key={option.id}
                      type="monotone"
                      dataKey={option.id}
                      name={option.label}
                      stroke={seriesPalette[index % seriesPalette.length]}
                      strokeWidth={3}
                      dot={{ r: 4 }}
                    />
                  ))}
                </LineChart>
              ) : chartType === "comparison" ? (
                <BarChart data={chartData} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  {yearGroups.map((group, index) => (
                    <ReferenceArea
                      fill={index % 2 ? "#7868e6" : "#68b39b"}
                      fillOpacity={0.06}
                      key={`comparison-area-${group.year}`}
                      strokeOpacity={0}
                      x1={group.firstAxisKey}
                      x2={group.lastAxisKey}
                    />
                  ))}
                  {yearGroups.slice(1).map((group) => (
                    <ReferenceLine
                      key={`comparison-boundary-${group.year}`}
                      stroke="#66707c"
                      strokeWidth={2}
                      x={group.firstAxisKey}
                    />
                  ))}
                  <XAxis dataKey="axisKey" height={98} interval={0} tick={renderDashboardAxisTick} tickMargin={12} />
                  <YAxis allowDecimals={false} />
                  <Tooltip
                    formatter={(value) => formatDashboardTooltipValue(value, selectedScaleCodes)}
                    labelFormatter={(_, payload) =>
                      formatDashboardTooltipLabel(payload[0]?.payload as DashboardChartAxisPoint | undefined)
                    }
                  />
                  <Legend formatter={renderDashboardLegendLabel} />
                  {selectedFieldRefs.map((option, index) => (
                    <Bar key={option.id} dataKey={option.id} name={option.label} fill={seriesPalette[index % seriesPalette.length]} />
                  ))}
                </BarChart>
              ) : (
                <PieChart>
                  <Tooltip
                    formatter={(value) => formatDashboardTooltipValue(value, selectedScaleCodes)}
                    labelFormatter={() => "Selected field average"}
                  />
                  <Legend formatter={renderDashboardLegendLabel} />
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={110} label>
                    {pieData.map((entry, index) => (
                      <Cell key={entry.name} fill={seriesPalette[index % seriesPalette.length]} />
                    ))}
                  </Pie>
                </PieChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <div className="dashboard-chart-footer">
        {canRemove ? (
          <button aria-label={`Remove chart ${chartNumber}`} className="small-action ghost" onClick={onRemove} type="button">
            Remove chart
          </button>
        ) : null}
        {showAdd ? (
          <button className="small-action" onClick={onAdd} type="button">
            Add chart
          </button>
        ) : null}
      </div>
    </div>
  );
}

type DashboardAxisTickProps = {
  x?: string | number;
  y?: string | number;
  payload?: { value?: unknown };
};

function DashboardAxisTick(
  props: DashboardAxisTickProps & { labelCharacterLimit: number; point?: DashboardChartPoint }
) {
  const x = Number(props.x);
  const y = Number(props.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const sectionLabel = compactDashboardChartLabel(props.point?.sectionLabel ?? "", props.labelCharacterLimit);
  const windowLabel = compactDashboardChartLabel(props.point?.windowLabel ?? "", props.labelCharacterLimit);
  const yearLabel = props.point?.yearLabel ?? "";
  const hasSection = Boolean(sectionLabel);
  const staggerSection = props.point?.sectionLine === 1;

  return (
    <g transform={`translate(${x},${y})`}>
      <title>{formatDashboardTooltipLabel(props.point)}</title>
      {hasSection ? (
        <text x={0} y={staggerSection ? 18 : 4} textAnchor="middle" fill="#101820" fontSize={10} fontWeight={900}>
          {sectionLabel}
        </text>
      ) : null}
      <text x={0} y={hasSection ? 38 : 12} textAnchor="middle" fill="#101820" fontSize={12} fontWeight={800}>
        {windowLabel}
      </text>
      <text x={0} y={hasSection ? 56 : 30} textAnchor="middle" fill="#66707c" fontSize={11} fontWeight={700}>
        {yearLabel}
      </text>
    </g>
  );
}

function DashboardDot(props: { cx?: number; cy?: number; payload?: { color?: string } }) {
  if (typeof props.cx !== "number" || typeof props.cy !== "number") return null;
  return (
    <circle
      cx={props.cx}
      cy={props.cy}
      r={5}
      fill={props.payload?.color ?? "#101820"}
      stroke="#101820"
      strokeWidth={1.5}
    />
  );
}

function dashboardSectionsForField(
  template: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate | undefined
) {
  if (!field?.sectionIds?.length) return [];
  const sectionsForRound = sectionsForAssessmentRound(template, round);
  const matchingSections = sectionsForRound.filter((section) => field.sectionIds?.includes(section.id));
  if (matchingSections.length || template.id !== "orf") return matchingSections;
  return sectionsForRound;
}

function averageDashboardFieldValue(
  placements: StudentPlacement[],
  rowsById: Map<string, OrfResultRow>,
  template: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate | undefined,
  schoolYear: string,
  section?: AssessmentSectionTemplate
) {
  const yearPlacements = placements.filter((placement) => placement.schoolYear === schoolYear);
  if (!field || !yearPlacements.length) return null;
  const sectionsForRound = section ? [section] : dashboardSectionsForField(template, round, field);
  const scaleCodes = scaleCodesForField(field);
  const values = yearPlacements
    .flatMap((placement) => {
      const row = rowsById.get(placement.studentId);
      if (!row) return [];
      const context = { schoolYear: placement.schoolYear, grade: placement.grade };
      if (sectionsForRound.length) {
        return sectionsForRound.map((section) => entryValue(row, template, round, field, section, context));
      }
      return [entryValue(row, template, round, field, undefined, context)];
    })
    .map((value) => dashboardChartValue(value, field, scaleCodes))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!values.length) return null;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
}

function dashboardChartValue(value: unknown, field: AssessmentFieldTemplate, scaleCodes: string[]) {
  if ((field.dataType === "letter" || field.dataType === "text") && scaleCodes.length) {
    const codeIndex = scaleCodes.findIndex((code) => code.toLowerCase() === String(value ?? "").trim().toLowerCase());
    return codeIndex >= 0 ? codeIndex + 1 : null;
  }

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDashboardTooltipValue(value: unknown, scaleCodes: string[]) {
  if (!scaleCodes.length) return value as number | string;
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return "";
  const exactCode = scaleCodes[numericValue - 1];
  if (exactCode) return exactCode;
  return numericValue.toFixed(1);
}

function compareSchoolYears(left: string, right: string) {
  return schoolYearStart(left) - schoolYearStart(right);
}

function windowIndicatorForRound(round: AssessmentRoundTemplate) {
  const labelParts = round.label.split("/");
  return labelParts.length > 1 ? labelParts[labelParts.length - 1].trim() : round.month;
}

function schoolYearStart(year: string) {
  const start = Number(year.split("-")[0]);
  return Number.isFinite(start) ? start : 0;
}

function dashboardStudentKey(row: OrfResultRow) {
  return normalizeStudentName(row.student);
}

function uniqueDashboardStudents(rows: OrfResultRow[]) {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = dashboardStudentKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((first, second) => first.student.localeCompare(second.student));
}

function uniqueDashboardRounds(assessments: AssessmentTemplate[]) {
  const seen = new Set<string>();
  return assessments
    .flatMap((assessment) => assessment.rounds)
    .filter((round) => {
      if (seen.has(round.id)) return false;
      seen.add(round.id);
      return true;
    });
}

function ProfilePage({
  isAdmin,
  activeTab,
  setActiveTab,
  profile,
  setProfile,
  currentRole,
  teamMembers,
  onAccessChange,
  assignmentHomerooms,
  onDeleteMember,
  events,
  pendingAuditEventIds,
  retryingAuditEventId,
  onRetryAuditEvent,
  importLogs,
  onRevertImport,
  authUser,
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
  teamMembers: TeamMember[];
  onAccessChange: (
    memberId: string,
    access: { role: UserRole; grade: string; homeroom: string }
  ) => Promise<void>;
  assignmentHomerooms: Record<string, string[]>;
  onDeleteMember: (memberId: string) => Promise<void>;
  events: AppAuditEvent[];
  pendingAuditEventIds: Set<string>;
  retryingAuditEventId: string | null;
  onRetryAuditEvent: (eventId: string) => Promise<void>;
  importLogs: ImportChangeLog[];
  onRevertImport: (importLogId: string) => Promise<ImportRevertOutcome>;
  authUser: User | null;
  openInvite: () => void;
  markUnsaved: (message?: string) => void;
  saveStatus: SaveStatus;
  saveMessage: string;
  onSave: () => Promise<void>;
}) {
  const visibleTab = isAdmin || activeTab === "password" ? activeTab : "profile";
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [passwordMessage, setPasswordMessage] = useState("Use your current password to set a new one.");
  const [roleUpdatingId, setRoleUpdatingId] = useState<string | null>(null);
  const [memberDeletingId, setMemberDeletingId] = useState<string | null>(null);
  const [memberPendingDelete, setMemberPendingDelete] = useState<TeamMember | null>(null);
  const [teamMessage, setTeamMessage] = useState("");
  const adminCount = teamMembers.filter((member) => member.role === "Admin").length;

  function updateProfileField(field: keyof typeof profile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
    markUnsaved("Profile changed. Save to update Firebase.");
  }

  async function updateTeamAccess(
    member: TeamMember,
    patch: Partial<Pick<TeamMember, "role" | "grade" | "homeroom">>
  ) {
    setRoleUpdatingId(member.id);
    setTeamMessage("Saving team access...");
    try {
      const access = resolveTeamMemberAccess(member, patch, assignmentHomerooms);
      await onAccessChange(member.id, access);
      setTeamMessage("Team access updated.");
    } catch (error) {
      setTeamMessage(friendlyCallableError(error));
    } finally {
      setRoleUpdatingId(null);
    }
  }

  async function deleteTeamUser(member: TeamMember) {
    setMemberDeletingId(member.id);
    setTeamMessage("");
    try {
      await onDeleteMember(member.id);
      setMemberPendingDelete(null);
      setTeamMessage(`${member.name || member.email} was deleted.`);
    } catch (error) {
      setTeamMessage(friendlyCallableError(error));
    } finally {
      setMemberDeletingId(null);
    }
  }

  async function changePassword() {
    if (!authUser?.email) {
      setPasswordStatus("error");
      setPasswordMessage("Sign in with an email account before changing your password.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordStatus("error");
      setPasswordMessage("Use a password with at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus("error");
      setPasswordMessage("The new passwords do not match.");
      return;
    }

    setPasswordStatus("saving");
    setPasswordMessage("Updating password...");
    try {
      const credential = EmailAuthProvider.credential(authUser.email, currentPassword);
      await reauthenticateWithCredential(authUser, credential);
      await updatePassword(authUser, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordStatus("success");
      setPasswordMessage("Password changed.");
    } catch (error) {
      setPasswordStatus("error");
      setPasswordMessage(friendlyPasswordError(error));
    }
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
        <button className={visibleTab === "password" ? "view-tab active" : "view-tab"} onClick={() => setActiveTab("password")} type="button">
          Change Password
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
        <div className="profile-save-row">
          <SaveBar status={saveStatus} message={saveMessage} onSave={onSave} compact />
        </div>
      ) : null}

      {visibleTab === "profile" ? (
        <div className="panel profile-form">
          <label>
            User name
            <input value={profile.name} onChange={(event) => updateProfileField("name", event.target.value)} />
          </label>
          <div className="profile-readonly-field">
            <span>Email address</span>
            <strong>{profile.email}</strong>
          </div>
          {currentRole === "Teacher / EA" ? (
            <>
              <div className="profile-readonly-field">
                <span>Grade</span>
                <strong>{profile.grade || "Not assigned"}</strong>
              </div>
              <div className="profile-readonly-field">
                <span>Home room</span>
                <strong>{profile.homeroom || "All home rooms"}</strong>
              </div>
            </>
          ) : null}
          <div className="profile-role">
            <span>Role</span>
            <strong>{currentRole}</strong>
          </div>
        </div>
      ) : null}

      {visibleTab === "password" ? (
        <div className="panel profile-form password-form">
          <label>
            Current password
            <input
              autoComplete="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            New password
            <input
              autoComplete="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm new password
            <input
              autoComplete="new-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <div className={`password-action ${passwordStatus}`}>
            <button
              className="primary-action"
              disabled={passwordStatus === "saving" || !currentPassword || !newPassword || !confirmPassword}
              onClick={changePassword}
              type="button"
            >
              {passwordStatus === "saving" ? "Changing..." : "Change Password"}
            </button>
            <span>{passwordMessage}</span>
          </div>
        </div>
      ) : null}

      {visibleTab === "audit" ? (
        <AuditLog
          events={events}
          importLogs={importLogs}
          pendingAuditEventIds={pendingAuditEventIds}
          retryingAuditEventId={retryingAuditEventId}
          onRetryAuditEvent={onRetryAuditEvent}
          onRevertImport={onRevertImport}
        />
      ) : null}

      {visibleTab === "team" ? (
        <div className="panel team-panel">
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
                <select
                  aria-label={`Role for ${member.name}`}
                  disabled={member.id === authUser?.uid || roleUpdatingId === member.id || memberDeletingId === member.id}
                  value={member.role}
                  onChange={(event) => updateTeamAccess(member, { role: event.target.value as UserRole })}
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                {member.role === "Teacher / EA" ? (
                  <>
                    <select
                      aria-label={`Grade for ${member.name}`}
                      disabled={roleUpdatingId === member.id || memberDeletingId === member.id}
                      value={member.grade}
                      onChange={(event) => updateTeamAccess(member, { grade: event.target.value, homeroom: "" })}
                    >
                      <option value="">Choose grade</option>
                      {Object.keys(assignmentHomerooms).sort((left, right) => Number(left) - Number(right)).map((grade) => (
                        <option key={grade} value={grade}>Grade {grade}</option>
                      ))}
                    </select>
                    <select
                      aria-label={`Home room for ${member.name}`}
                      disabled={!member.grade || roleUpdatingId === member.id || memberDeletingId === member.id}
                      value={member.homeroom}
                      onChange={(event) => updateTeamAccess(member, { homeroom: event.target.value })}
                    >
                      <option value="">All home rooms (optional)</option>
                      {(assignmentHomerooms[member.grade] ?? []).map((homeroom) => (
                        <option key={homeroom} value={homeroom}>{homeroom}</option>
                      ))}
                    </select>
                  </>
                ) : null}
                {member.role !== "Admin" || adminCount > 1 ? (
                  <button
                    className="danger-action team-delete-action"
                    disabled={memberDeletingId !== null || roleUpdatingId === member.id}
                    onClick={() => setMemberPendingDelete(member)}
                    type="button"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {teamMessage ? <p className="team-message">{teamMessage}</p> : null}
        </div>
      ) : null}

      {memberPendingDelete ? (
        <DeleteTeamMemberModal
          deleting={memberDeletingId === memberPendingDelete.id}
          member={memberPendingDelete}
          onClose={() => setMemberPendingDelete(null)}
          onDelete={() => deleteTeamUser(memberPendingDelete)}
        />
      ) : null}
    </section>
  );
}

function DeleteTeamMemberModal({
  deleting,
  member,
  onClose,
  onDelete
}: {
  deleting: boolean;
  member: TeamMember;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete organization user">
      <section className="notes-modal panel">
        <div className="modal-top">
          <div>
            <p className="eyebrow">Are you sure?</p>
            <h2>Delete {member.name || member.email}?</h2>
          </div>
        </div>

        <p>
          This permanently removes this user&apos;s sign-in access and signs them out of any open app session.
          Student and assessment records are not deleted.
        </p>

        <div className="modal-actions">
          <button className="small-action ghost" disabled={deleting} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="danger-action" disabled={deleting} onClick={onDelete} type="button">
            {deleting ? "Deleting..." : "Delete user"}
          </button>
        </div>
      </section>
    </div>
  );
}

function InviteModal({
  onClose,
  onInvite
}: {
  onClose: () => void;
  onInvite: (invite: { email: string; name: string; role: UserRole }) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("Teacher / EA");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");
  const inviteReady = Boolean(email.trim() && name.trim());

  async function sendInvite() {
    setStatus("sending");
    setMessage("");
    try {
      await onInvite({ email, name, role });
    } catch (error) {
      setStatus("error");
      setMessage(friendlyCallableError(error));
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Invite team members">
      <section className="notes-modal panel">
        <div className="modal-top">
          <div>
            <p className="eyebrow">Team</p>
            <h2>Invite a user</h2>
          </div>
          <button className="small-action ghost" disabled={status === "sending"} onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="invite-fields">
          <label>
            Name
            <input
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Example: Lindsey Bingley"
            />
          </label>
          <label>
            Email
            <input
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@school.ca"
            />
          </label>
          <label>
            Role
            <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              {roles.map((roleOption) => (
                <option key={roleOption} value={roleOption}>
                  {roleOption}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="invite-explainer">
          Firebase will email a single-use link so this user can set their own password. No temporary password is sent.
        </p>
        {message ? <div className="auth-message">{message}</div> : null}
        <div className="modal-actions">
          <button
            className="primary-action"
            disabled={!inviteReady || status === "sending"}
            onClick={sendInvite}
            type="button"
          >
            {status === "sending" ? "Sending invitation..." : "Send invitation"}
          </button>
        </div>
      </section>
    </div>
  );
}

function StudentReport({
  rows,
  placements,
  templates,
  schoolYears,
  recordAudit
}: {
  rows: OrfResultRow[];
  placements: StudentPlacement[];
  templates: AssessmentTemplate[];
  schoolYears: string[];
  recordAudit: RecordAudit;
}) {
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const reportStudents = useMemo(() => buildStudentIdentityOptions(rows, placements), [placements, rows]);
  const reportStudentsById = useMemo(
    () => new Map(reportStudents.map((student) => [student.id, student])),
    [reportStudents]
  );
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>(() =>
    reportStudents[0] ? [reportStudents[0].id] : []
  );
  const hasInitializedStudentSelectionRef = useRef(reportStudents.length > 0);
  const [studentSearchText, setStudentSearchText] = useState("");
  const [studentSearchOpen, setStudentSearchOpen] = useState(false);
  const [assessmentIds, setAssessmentIds] = useState<string[]>(templates[0] ? [templates[0].id] : []);
  const [evaluationPickerOpen, setEvaluationPickerOpen] = useState(false);
  const [selectedYears, setSelectedYears] = useState<string[]>(schoolYears);
  const selectedStudents = useMemo(
    () =>
      selectedStudentIds.reduce<Array<{ id: string; name: string; detail: string; row: OrfResultRow }>>(
        (students, studentId) => {
          const option = reportStudentsById.get(studentId);
          const row = rowsById.get(studentId);
          if (option && row) students.push({ ...option, row });
          return students;
        },
        []
      ),
    [reportStudentsById, rowsById, selectedStudentIds]
  );
  const matchingStudentOptions = useMemo(
    () => matchingReportStudentOptions(reportStudents, selectedStudentIds, studentSearchText),
    [reportStudents, selectedStudentIds, studentSearchText]
  );
  const selectedTemplates = useMemo(
    () => templates.filter((template) => assessmentIds.includes(template.id)),
    [assessmentIds, templates]
  );
  const allEvaluationsSelected = templates.length > 0 && templates.every((template) => assessmentIds.includes(template.id));
  const evaluationPickerLabel = allEvaluationsSelected
    ? "All evaluations"
    : selectedTemplates.length === 1
      ? selectedTemplates[0].name
      : selectedTemplates.length
        ? `${selectedTemplates.length} evaluations`
        : "No evaluations";
  const allYearsSelected = schoolYears.length > 0 && schoolYears.every((year) => selectedYears.includes(year));
  const reportBlocks = useMemo(
    () =>
      buildStudentReportBlocks(
        selectedTemplates.map((template) => ({
          assessmentId: template.id,
          assessmentName: template.name,
          rows: selectedStudents.flatMap((student) =>
            studentReportRows(student.id, student.name, template, selectedYears, placements, rowsById)
          )
        }))
      ),
    [placements, rowsById, selectedStudents, selectedTemplates, selectedYears]
  );
  const sortedSelectedYears = useMemo(() => selectedYears.slice().sort(compareSchoolYears), [selectedYears]);

  useEffect(() => {
    setAssessmentIds((current) => {
      const valid = current.filter((id) => templates.some((template) => template.id === id));
      return valid.length ? valid : templates[0] ? [templates[0].id] : [];
    });
  }, [templates]);

  useEffect(() => {
    setSelectedStudentIds((current) => {
      const valid = reconcileReportStudentIds(current, reportStudents);
      if (!hasInitializedStudentSelectionRef.current && reportStudents[0]) {
        hasInitializedStudentSelectionRef.current = true;
        return valid.length ? valid : [reportStudents[0].id];
      }
      return valid;
    });
  }, [reportStudents]);

  useEffect(() => {
    setSelectedYears((current) => current.filter((year) => schoolYears.includes(year)));
  }, [schoolYears]);

  function toggleReportYear(year: string) {
    setSelectedYears((current) =>
      current.includes(year) ? current.filter((selectedYear) => selectedYear !== year) : [...current, year]
    );
  }

  function toggleReportEvaluation(id: string) {
    setAssessmentIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return next.length ? next : current;
    });
  }

  function selectReportStudent(studentId: string) {
    setSelectedStudentIds((current) => addReportStudentId(current, studentId));
    setStudentSearchText("");
    setStudentSearchOpen(false);
  }

  function removeReportStudent(studentId: string) {
    setSelectedStudentIds((current) => removeReportStudentId(current, studentId));
  }

  function downloadExcelReport() {
    if (!selectedStudents.length || !selectedTemplates.length || !selectedYears.length || !reportBlocks.length) return;
    const workbook = studentReportWorkbook(reportBlocks);
    const assessmentName = selectedTemplates.length === 1 ? selectedTemplates[0].name : "Multiple Evaluations";
    const studentFileLabel = selectedStudents.length === 1 ? selectedStudents[0].name : `${selectedStudents.length}-students`;
    const auditStudentLabel = selectedStudents.length === 1 ? selectedStudents[0].name : `${selectedStudents.length} students`;
    const selectedStudentNames = selectedStudents.map((student) => student.name).join(", ");
    XLSX.writeFile(workbook, `${safeFileName(`${studentFileLabel}-${assessmentName}-assessment-report`)}.xlsx`, {
      compression: true
    });
    recordAudit(
      "Downloaded report",
      "Student report",
      auditStudentLabel,
      `Generated an Excel report for ${selectedStudentNames}; evaluations: ${selectedTemplates.map((template) => template.name).join(", ")}; years: ${selectedYears.join(", ")}.`
    );
  }

  return (
    <section className="report-layout">
      <div className="panel report-controls">
        <p className="eyebrow">Student Report</p>
        <h2>Student assessment summary</h2>
        <p>Generate one report for one or more students to share assessment context with an Ed Psych team.</p>

        <div className="report-student-picker">
          <div className="report-student-search-box">
            <label className="report-student-search">
              Find students
              <input
                aria-autocomplete="list"
                aria-controls="report-student-search-results"
                aria-expanded={studentSearchOpen && matchingStudentOptions.length > 0}
                autoComplete="off"
                placeholder="Search by student name"
                role="combobox"
                value={studentSearchText}
                onBlur={() => setStudentSearchOpen(false)}
                onChange={(event) => {
                  setStudentSearchText(event.target.value);
                  setStudentSearchOpen(true);
                }}
                onFocus={() => setStudentSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setStudentSearchOpen(false);
                    return;
                  }
                  if (event.key === "Enter" && studentSearchText.trim() && matchingStudentOptions[0]) {
                    event.preventDefault();
                    selectReportStudent(matchingStudentOptions[0].id);
                  }
                }}
              />
            </label>
            {studentSearchOpen && matchingStudentOptions.length ? (
              <div
                className="overview-student-search-results report-student-search-results"
                id="report-student-search-results"
                role="listbox"
              >
                {matchingStudentOptions.map((option) => (
                  <button
                    aria-selected="false"
                    key={option.id}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectReportStudent(option.id);
                    }}
                    role="option"
                    type="button"
                  >
                    <strong>{option.name}</strong>
                    <span>{option.detail}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="report-selected-students" aria-label="Selected students" role="list">
            {selectedStudents.length ? (
              selectedStudents.map((student) => (
                <div className="report-student-chip" key={student.id} role="listitem">
                  <span>
                    <strong>{student.name}</strong>
                    <small>{student.detail}</small>
                  </span>
                  <button
                    aria-label={`Remove ${student.name}, ${student.detail}`}
                    onClick={() => removeReportStudent(student.id)}
                    title={`Remove ${student.name}`}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))
            ) : (
              <p className="report-student-empty">No students selected.</p>
            )}
          </div>
        </div>

        <div className="multi-picker">
          <span>Evaluation</span>
          <button className="picker-field-button" onClick={() => setEvaluationPickerOpen((open) => !open)} type="button">
            <span>{evaluationPickerLabel}</span>
            <span className="dropdown-arrow" aria-hidden="true" />
          </button>
          {evaluationPickerOpen ? (
            <div className="multi-picker-menu wide">
              <label className="checkbox-row select-all-row">
                <input
                  checked={allEvaluationsSelected}
                  onChange={() => setAssessmentIds(allEvaluationsSelected ? (templates[0] ? [templates[0].id] : []) : templates.map((template) => template.id))}
                  type="checkbox"
                />
                All evaluations
              </label>
              {templates.map((template) => (
                <label className="checkbox-row" key={template.id}>
                  <input checked={assessmentIds.includes(template.id)} onChange={() => toggleReportEvaluation(template.id)} type="checkbox" />
                  {template.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <div className="report-year-picker">
          <label className="checkbox-row select-all-row">
            <input
              checked={allYearsSelected}
              onChange={() => setSelectedYears(allYearsSelected ? [] : schoolYears)}
              type="checkbox"
            />
            Select all years
          </label>
          {schoolYears.map((year) => (
            <label className="checkbox-row" key={year}>
              <input checked={selectedYears.includes(year)} onChange={() => toggleReportYear(year)} type="checkbox" />
              {year}
            </label>
          ))}
        </div>

        <button
          className="primary-action"
          disabled={!selectedStudents.length || !selectedTemplates.length || !selectedYears.length}
          onClick={downloadExcelReport}
          type="button"
        >
          Download Excel report
        </button>
      </div>

      <div className="panel report-preview">
        <div className="report-paper">
          <header className="report-document-header">
            <p className="eyebrow">Student Assessment Report</p>
            <h2>Assessment summary</h2>
            <dl>
              <div>
                <dt>Students</dt>
                <dd>{selectedStudents.length ? selectedStudents.map((student) => student.name).join(", ") : "None selected"}</dd>
              </div>
              <div>
                <dt>Years</dt>
                <dd>{sortedSelectedYears.length ? sortedSelectedYears.join(", ") : "None selected"}</dd>
              </div>
            </dl>
          </header>

          {!selectedStudents.length ? (
            <p className="report-preview-empty">Select at least one student to preview a report.</p>
          ) : !selectedTemplates.length ? (
            <p className="report-preview-empty">Select at least one evaluation to preview a report.</p>
          ) : !selectedYears.length ? (
            <p className="report-preview-empty">Select at least one school year to preview a report.</p>
          ) : (
            <div className="report-assessment-stack">
              {reportBlocks.map((block) => (
                <StudentReportAssessmentTable block={block} key={block.assessmentId} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StudentReportAssessmentTable({ block }: { block: StudentReportBlock }) {
  const yearGroups = studentReportHeaderGroups(block.columns, "year");
  const windowGroups = studentReportHeaderGroups(block.columns, "window");
  const sectionGroups = studentReportHeaderGroups(block.columns, "section");

  return (
    <section aria-label={`${block.assessmentName} report`} className="report-assessment-block">
      <h3>{block.assessmentName}</h3>
      <div className="report-table-scroll">
        <table className="report-assessment-table">
          <caption>{block.assessmentName} assessment results</caption>
          <thead>
            <tr>
              <th colSpan={4} scope="row">Assessment Year</th>
              {yearGroups.map((group) => (
                <th colSpan={group.span} key={group.key} scope="colgroup">{group.label}</th>
              ))}
            </tr>
            <tr>
              <th colSpan={4} scope="row">Assessment Window</th>
              {windowGroups.map((group) => (
                <th
                  colSpan={group.span}
                  key={group.key}
                  scope="colgroup"
                  style={{ backgroundColor: group.windowColor }}
                >
                  {group.label}
                </th>
              ))}
            </tr>
            <tr>
              <th colSpan={4} scope="row">Assessment Section</th>
              {sectionGroups.map((group) => (
                <th
                  colSpan={group.span}
                  key={group.key}
                  scope="colgroup"
                  style={{ backgroundColor: group.windowColor }}
                >
                  {group.label}
                </th>
              ))}
            </tr>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Grade</th>
              <th scope="col">Homeroom</th>
              <th scope="col">Year</th>
              {block.columns.map((column) => (
                <th key={column.key} scope="col" style={{ backgroundColor: column.windowColor }}>
                  {column.field}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.length ? (
              block.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.student}</th>
                  <td>{row.grade || "-"}</td>
                  <td>{row.homeroom || "-"}</td>
                  <td>{row.year}</td>
                  {block.columns.map((column) => (
                    <td key={column.key} style={{ backgroundColor: column.windowColor }}>
                      {row.values[column.key] || "-"}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={Math.max(4, block.columns.length + 4)}>No assessment data matches the selected students and years.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function studentReportRows(
  studentId: string,
  studentName: string,
  template: AssessmentTemplate,
  selectedYears: string[],
  placements: StudentPlacement[],
  rowsById: Map<string, OrfResultRow>
): StudentReportSourceRow[] {
  const reportRows: StudentReportSourceRow[] = [];

  selectedYears
    .slice()
    .sort(compareSchoolYears)
    .forEach((year) => {
      const yearTemplate = assessmentTemplateForYear(template, year);
      const yearRowStart = reportRows.length;
      const yearPlacements = placements
        .filter((placement) => placement.schoolYear === year)
        .filter((placement) => placement.studentId === studentId);

      yearPlacements.forEach((placement) => {
        const student = rowsById.get(placement.studentId);
        if (!student) return;
        const context = { schoolYear: placement.schoolYear, grade: placement.grade };

        yearTemplate.rounds.forEach((round) => {
          const sectionsForRound = sectionsForAssessmentRound(yearTemplate, round, placement.grade);
          const fieldsForRound = yearTemplate.fields.filter((field) =>
            assessmentFieldAppliesToGrade(field, placement.grade) &&
            (!field.roundIds?.length || field.roundIds.includes(round.id))
          );

          sectionsForRound.forEach((section) => {
            fieldsForRound
              .filter((field) => field.sectionIds?.includes(section.id))
              .forEach((field) => {
                reportRows.push({
                  studentId,
                  year,
                  grade: placement.grade,
                  homeroom: placement.homeroom,
                  student: student.student,
                  assessmentId: template.id,
                  assessment: yearTemplate.name,
                  roundId: round.id,
                  window: round.label,
                  windowColor: round.color ?? "#fffaf0",
                  sectionId: section.id,
                  section: section.name,
                  fieldId: field.id,
                  field: field.name,
                  value: formatReportValue(entryValue(student, yearTemplate, round, field, section, context))
                });
              });
          });

          fieldsForRound
            .filter((field) => !field.sectionIds?.some((sectionId) => sectionsForRound.some((section) => section.id === sectionId)))
            .forEach((field) => {
              reportRows.push({
                studentId,
                year,
                grade: placement.grade,
                homeroom: placement.homeroom,
                student: student.student,
                assessmentId: template.id,
                assessment: yearTemplate.name,
                roundId: round.id,
                window: round.label,
                windowColor: round.color ?? "#fffaf0",
                sectionId: "",
                section: "",
                fieldId: field.id,
                field: field.name,
                value: formatReportValue(entryValue(student, yearTemplate, round, field, undefined, context))
              });
          });
        });
      });

      if (reportRows.length === yearRowStart) {
        reportRows.push({
          studentId,
          year,
          grade: "",
          homeroom: "",
          student: studentName,
          assessmentId: template.id,
          assessment: yearTemplate.name,
          roundId: STUDENT_REPORT_NO_DATA_ID,
          window: "No data",
          windowColor: "#fffaf0",
          sectionId: STUDENT_REPORT_NO_DATA_ID,
          section: "No data",
          fieldId: STUDENT_REPORT_NO_DATA_ID,
          field: "No data",
          value: ""
        });
      }
    });

  return reportRows;
}

function studentReportWorkbook(blocks: StudentReportBlock[]) {
  const layout = buildStudentReportWorksheetLayout(blocks);
  const worksheet = XLSX.utils.aoa_to_sheet(layout.rows);
  worksheet["!merges"] = layout.merges.map((merge) => ({
    s: { r: merge.startRow, c: merge.startColumn },
    e: { r: merge.endRow, c: merge.endColumn }
  }));

  const dynamicColumnCount = Math.max(0, ...blocks.map((block) => block.columns.length));
  worksheet["!cols"] = [
    { wch: 24 },
    { wch: 10 },
    { wch: 14 },
    { wch: 13 },
    ...Array.from({ length: dynamicColumnCount }, (_, index) => {
      const fieldWidth = Math.max(0, ...blocks.map((block) => block.columns[index]?.field.length ?? 0));
      return { wch: Math.max(12, Math.min(24, fieldWidth + 2)) };
    })
  ];
  layout.blocks.forEach((block) => styleReportWorksheetBlock(worksheet, block));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Student Report");
  return workbook;
}

function styleReportWorksheetBlock(worksheet: XLSX.WorkSheet, range: StudentReportWorksheetBlock) {
  for (let row = range.titleRow; row <= range.endRow; row += 1) {
    for (let column = 0; column < range.columnCount; column += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = worksheet[cellAddress];
      if (!cell) continue;

      const isTitle = row === range.titleRow;
      const isHeader = row >= range.headerStartRow && row < range.dataStartRow;
      const reportColumn = column >= 4 ? range.block.columns[column - 4] : undefined;
      const windowColor = reportColumn?.windowColor.replace("#", "").toUpperCase();
      const fillColor = isTitle ? "24465B" : windowColor || (isHeader && column < 4 ? "EFE7D5" : undefined);
      cell.s = {
        ...(cell.s ?? {}),
        alignment: {
          horizontal: isTitle ? "left" : isHeader ? "center" : "left",
          vertical: "center",
          wrapText: true
        },
        font: isTitle ? { bold: true, color: { rgb: "FFFFFF" } } : isHeader ? { bold: true } : undefined,
        fill: fillColor ? { patternType: "solid", fgColor: { rgb: fillColor } } : undefined,
        border: {
          top: { style: "thin", color: { rgb: "B8B0A1" } },
          right: { style: "thin", color: { rgb: "B8B0A1" } },
          bottom: { style: "thin", color: { rgb: "B8B0A1" } },
          left: { style: "thin", color: { rgb: "B8B0A1" } }
        }
      };
    }
  }
}

function formatReportValue(value: unknown) {
  return value === null || typeof value === "undefined" ? "" : String(value);
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim() || "student-assessment-report";
}

function downloadCsvFile(fileName: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function isStudentNumberConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("student_studentNumber_uidx") || message.includes("ALREADY_EXISTS");
}

function readableImportError(error: unknown) {
  if (isStudentNumberConstraintError(error)) {
    return "Some students in this file already exist in Firebase for the selected year. Review the duplicate student list, then download it as CSV if needed.";
  }
  return error instanceof Error ? error.message : "Import failed.";
}

type ImportColumnMatch = {
  assessment: AssessmentTemplate;
  round: AssessmentRoundTemplate;
  field: AssessmentFieldTemplate;
  section?: AssessmentSectionTemplate;
  fieldName: string;
};

type ParsedImportStudent = {
  studentName: string;
  homeroom: string;
  sourceRowNumber: number;
  values: Array<{
    value: string | number | boolean | Date | null;
    match: ImportColumnMatch;
  }>;
};

type ParsedImportFile = {
  students: ParsedImportStudent[];
};

async function parseStudentImportFile(file: File, templates: AssessmentTemplate[]): Promise<ParsedImportFile> {
  if (file.name.toLowerCase().endsWith(".gsheet")) {
    throw new Error("Google Sheets shortcut files cannot be read directly. Export the sheet as Excel or CSV, then import that file.");
  }

  const workbook = file.name.toLowerCase().endsWith(".csv")
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;
  if (!worksheet) throw new Error("The selected file does not include a readable worksheet.");

  const rows = worksheetToImportRows(worksheet);
  const headerLocation = findStudentHeaderLocation(rows);
  if (!headerLocation) {
    throw new Error("Import stopped: no Student Name column was found.");
  }

  const { rowIndex: headerRowIndex, columnIndex: studentColumnIndex } = headerLocation;
  const homeroomColumnIndex = findHomeroomColumnIndex(rows[headerRowIndex] ?? []);
  const importColumns = rows[headerRowIndex].map((_, columnIndex) => {
    if (columnIndex === studentColumnIndex || columnIndex === homeroomColumnIndex) return null;
    const headers = columnHeadersForImportColumn(rows, headerRowIndex, columnIndex);
    return findImportColumnMatch(headers, templates);
  });
  const students = rows
    .slice(headerRowIndex + 1)
    .map((row, dataRowIndex): ParsedImportStudent | null => {
      const studentName = importCellText(row[studentColumnIndex]);
      if (!studentName) return null;
      const homeroom = homeroomColumnIndex >= 0 ? importCellText(row[homeroomColumnIndex]) || "Imported" : "Imported";
      return {
        studentName,
        homeroom,
        sourceRowNumber: headerRowIndex + dataRowIndex + 2,
        values: importColumns
          .map((match, columnIndex) => {
            if (!match) return null;
            return {
              value: row[columnIndex] ?? null,
              match
            };
          })
          .filter((item): item is ParsedImportStudent["values"][number] => Boolean(item))
      };
    })
    .filter((student): student is ParsedImportStudent => Boolean(student));

  return { students };
}

function worksheetToImportRows(worksheet: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(String(worksheet["!ref"] ?? "A1:A1"));
  const merges = (worksheet["!merges"] as XLSX.Range[] | undefined) ?? [];
  const rows: Array<Array<string | number | boolean | Date | null>> = [];

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const nextRow: Array<string | number | boolean | Date | null> = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      nextRow.push(importWorksheetCellValue(worksheet, row, column, merges));
    }
    rows.push(nextRow);
  }

  return rows;
}

function importWorksheetCellValue(worksheet: XLSX.WorkSheet, row: number, column: number, merges: XLSX.Range[]) {
  const mergedRange = merges.find((merge) => row >= merge.s.r && row <= merge.e.r && column >= merge.s.c && column <= merge.e.c);
  const source = mergedRange?.s ?? { r: row, c: column };
  const cell = worksheet[XLSX.utils.encode_cell(source)];
  return (cell?.v ?? null) as string | number | boolean | Date | null;
}

function findStudentHeaderLocation(rows: Array<Array<unknown>>) {
  const searchRows = rows.slice(0, 12);
  for (let rowIndex = 0; rowIndex < searchRows.length; rowIndex += 1) {
    const columnIndex = searchRows[rowIndex].findIndex((cell) => studentHeaderLabels.has(normalizedImportLabel(cell)));
    if (columnIndex >= 0) return { rowIndex, columnIndex };
  }
  return null;
}

function findHomeroomColumnIndex(headerRow: Array<unknown>) {
  return headerRow.findIndex((cell) => homeroomHeaderLabels.has(normalizedImportLabel(cell)));
}

function columnHeadersForImportColumn(rows: Array<Array<unknown>>, headerRowIndex: number, columnIndex: number) {
  const firstHeaderRow = Math.max(0, headerRowIndex - 3);
  return rows
    .slice(firstHeaderRow, headerRowIndex + 1)
    .map((row, index) => importCellText(headerValueForImportColumn(row, columnIndex, index < 2)))
    .filter(Boolean);
}

function headerValueForImportColumn(row: Array<unknown>, columnIndex: number, allowForwardFill: boolean) {
  const directValue = row[columnIndex];
  if (importCellText(directValue) || !allowForwardFill) return directValue;

  for (let index = columnIndex - 1; index >= 0; index -= 1) {
    const candidate = row[index];
    if (importCellText(candidate)) return candidate;
  }

  return directValue;
}

function findImportColumnMatch(headers: string[], templates: AssessmentTemplate[]): ImportColumnMatch | null {
  if (!headers.length) return null;
  const normalizedHeaders = headers.map(normalizedImportLabel).filter(Boolean);

  for (const assessment of templates) {
    if (!looseHeaderLabelMatch(normalizedHeaders, [assessment.name, assessment.id])) continue;
    for (const round of assessment.rounds) {
      if (!looseHeaderLabelMatch(normalizedHeaders, [round.label, round.month, windowIndicatorForRound(round), round.id])) continue;
      const sectionsForRound = sectionsForAssessmentRound(assessment, round);
      for (const field of assessment.fields) {
        if (!fieldMatchesRound(field, round) || !fieldHeaderLabelMatch(normalizedHeaders, field)) continue;
        const fieldSections = sectionsForRound.filter((section) => field.sectionIds?.includes(section.id));
        if (!fieldSections.length) {
          return { assessment, round, field, fieldName: assessmentValueKey(assessment, round, field) };
        }
        const section = fieldSections.find((candidate) => exactHeaderLabelMatch(normalizedHeaders, [candidate.name, candidate.id]));
        if (section) return { assessment, round, field, section, fieldName: assessmentValueKey(assessment, round, field, section) };
      }
    }
  }

  return null;
}

function fieldMatchesRound(field: AssessmentFieldTemplate, round: AssessmentRoundTemplate) {
  return !field.roundIds?.length || field.roundIds.includes(round.id);
}

function exactHeaderLabelMatch(normalizedHeaders: string[], labels: Array<string | undefined>) {
  return labels.some((label) => {
    const normalizedLabel = normalizedImportLabel(label);
    return Boolean(normalizedLabel && normalizedHeaders.includes(normalizedLabel));
  });
}

function fieldHeaderLabelMatch(normalizedHeaders: string[], field: AssessmentFieldTemplate) {
  const compactHeaderPath = normalizedHeaders.join("");
  return [field.name, field.slug, field.id].some((label) => {
    const normalizedLabel = normalizedImportLabel(label);
    if (!normalizedLabel) return false;
    return normalizedHeaders.includes(normalizedLabel) || compactHeaderPath.includes(normalizedLabel);
  });
}

function looseHeaderLabelMatch(normalizedHeaders: string[], labels: Array<string | undefined>) {
  const compactHeaderPath = normalizedHeaders.join("");
  return labels.some((label) => {
    const normalizedLabel = normalizedImportLabel(label);
    if (!normalizedLabel) return false;
    return (
      normalizedHeaders.includes(normalizedLabel) ||
      compactHeaderPath.includes(normalizedLabel) ||
      normalizedHeaders.some((header) => header.includes(normalizedLabel) || normalizedLabel.includes(header))
    );
  });
}

const studentHeaderLabels = new Set(["studentname", "student", "name", "studentfullname", "fullname"]);
const homeroomHeaderLabels = new Set(["homeroom", "home room", "hr", "classroom", "class"]);

function normalizedImportLabel(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function importCellText(value: unknown) {
  return String(value ?? "").trim();
}

function schoolYearImportOptions() {
  const startYear = new Date().getFullYear();
  return Array.from({ length: 21 }, (_, index) => {
    const year = startYear - index;
    return `${year}-${year + 1}`;
  });
}

type ScaleRow = {
  title: string;
  code: string;
};

function scaleSummariesForAssessment(assessment: AssessmentTemplate): ScaleSummary[] {
  return assessment.fields
    .filter((field) => !field.isCalculated && (field.dataType === "letter" || field.dataType === "text") && Boolean(field.letterRanks?.trim()))
    .map((field) => ({
      fieldName: field.name,
      rows: parseScaleRows(field.letterRanks ?? "").filter((row) => row.title || row.code)
    }))
    .filter((summary) => summary.rows.length > 0);
}

function scaleCodesForField(field: AssessmentFieldTemplate) {
  if (field.dataType !== "letter" && field.dataType !== "text") return [];
  return parseScaleRows(field.letterRanks ?? "")
    .map((row) => row.code.trim())
    .filter(Boolean);
}

function printableEditorCharacter(key?: string | null) {
  if (!key || key.length !== 1) return null;
  return key;
}

function parseScaleRows(value: string): ScaleRow[] {
  if (!value.trim()) return [{ title: "", code: "" }];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      const rows = parsed
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const candidate = row as Partial<ScaleRow>;
          return {
            title: String(candidate.title ?? ""),
            code: String(candidate.code ?? "")
          };
        })
        .filter((row): row is ScaleRow => Boolean(row));
      if (rows.length) return rows;
    }
  } catch {
    // Older fields used a comma-separated list. Fall through and upgrade it into rows.
  }

  const rows = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({ title: item, code: item }));
  return rows.length ? rows : [{ title: "", code: "" }];
}

function serializeScaleRows(rows: ScaleRow[]) {
  const cleanRows = rows.map((row) => ({ title: row.title.trim(), code: row.code.trim() }));
  return JSON.stringify(cleanRows);
}

function StudentNotesModal({
  student,
  notes,
  isAdmin,
  onClose,
  addNote,
  editNote,
  deleteNote
}: {
  student: OrfResultRow;
  notes: StudentNote[];
  isAdmin: boolean;
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
              {isAdmin ? <option value="admin_only">Admin only</option> : null}
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
  const [studentCountText, setStudentCountText] = useState("1");
  const studentCount = parseOverviewStudentCount(studentCountText);
  const studentCountIsValid = studentCount !== null;
  const canAdd = Boolean(homeroom.trim()) && studentCountIsValid;

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
            aria-describedby="student-count-help"
            aria-invalid={!studentCountIsValid}
            inputMode="numeric"
            pattern="[0-9]*"
            type="text"
            value={studentCountText}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (/^\d*$/.test(nextValue)) setStudentCountText(nextValue);
            }}
            onFocus={(event) => event.currentTarget.select()}
          />
          <small className={studentCountIsValid ? "field-help" : "field-help field-error"} id="student-count-help">
            {studentCountIsValid ? "Enter a whole number from 1 to 40." : "Student count must be a whole number from 1 to 40."}
          </small>
        </label>

        <button
          className="primary-action"
          disabled={!canAdd}
          onClick={() => studentCount !== null && onAdd(homeroom.trim(), studentCount)}
          type="button"
        >
          Add
        </button>
      </section>
    </div>
  );
}

function OverviewImportModal({
  currentYear,
  currentGrade,
  lockedYears,
  onClose,
  onImport,
  onRevert
}: {
  currentYear: string;
  currentGrade: string;
  lockedYears: string[];
  onClose: () => void;
  onImport: (request: OverviewImportRequest) => Promise<OverviewImportResult>;
  onRevert: (importLogId: string) => Promise<ImportRevertOutcome>;
}) {
  const [schoolYear, setSchoolYear] = useState(currentYear);
  const [grade, setGrade] = useState(currentGrade);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "importing" | "complete" | "reverting" | "reverted" | "error">("idle");
  const [message, setMessage] = useState("Choose an Excel, Google Sheets export, or CSV file to import.");
  const [result, setResult] = useState<OverviewImportResult | null>(null);
  const yearOptions = useMemo(() => schoolYearImportOptions(), []);
  const selectedYearLocked = !canImportOverviewYear(schoolYear, lockedYears);

  async function startImport() {
    if (selectedYearLocked) {
      setStatus("error");
      setMessage(`Import is disabled because ${schoolYear} is locked. Unlock the year before importing.`);
      return;
    }
    if (!file) {
      setStatus("error");
      setMessage("Choose a spreadsheet or CSV file before importing.");
      return;
    }

    setStatus("importing");
    setMessage("Importing students and matching assessment data...");
    try {
      const nextResult = await onImport({ file, schoolYear, grade });
      setResult(nextResult);
      setStatus("complete");
      setMessage(
        nextResult.sqlSyncPending
          ? "Import saved to the shared workspace, but SQL synchronization is pending and will retry on reload. Do not import the file again."
          : nextResult.auditSaved
          ? "Import complete."
          : "Import complete, but the shared audit entry is pending. Ask an Admin to retry or reconcile the audit before relying on the record."
      );
    } catch (error) {
      setStatus("error");
      setMessage(readableImportError(error));
    }
  }

  async function revertImport() {
    if (!result || status === "reverting") return;
    setStatus("reverting");
    setMessage("Reverting this import...");
    try {
      const outcome = await onRevert(result.importLogId);
      if (outcome === "reverted" || outcome === "reverted-audit-pending") {
        setStatus("reverted");
        setMessage(
          outcome === "reverted"
            ? "Import reverted and rollback saved."
            : "Import data was reverted, but the shared audit entry is pending. Ask an Admin to retry or reconcile the audit."
        );
      } else if (outcome === "cancelled") {
        setStatus("complete");
        setMessage("Revert cancelled. The imported data remains unchanged.");
      } else {
        setStatus("error");
        setMessage("This import is already reverted or another rollback is in progress.");
      }
    } catch (error) {
      setStatus("error");
      setMessage(`Revert failed. ${error instanceof Error ? error.message : "Please try again."}`);
    }
  }

  function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setFile(nextFile);
    setStatus("idle");
    setResult(null);
    setMessage(`${nextFile.name} is ready to import.`);
  }

  function downloadDuplicateCsv() {
    if (!result?.duplicateNames.length) return;
    downloadCsvFile(
      `${safeFileName(`${result.schoolYear}-grade-${result.grade}-duplicate-students`)}.csv`,
      [["Student Name"], ...result.duplicateNames.map((name) => [name])]
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Import student spreadsheet">
      <section className="notes-modal import-modal panel">
        <div className="modal-top">
          <div>
            <p className="eyebrow">Overview import</p>
            <h2>Import students and assessment data</h2>
          </div>
          <button className="small-action ghost" disabled={status === "reverting"} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="import-controls">
          <label>
            Year
            <select
              value={schoolYear}
              onChange={(event) => {
                const nextYear = event.target.value;
                setSchoolYear(nextYear);
                setResult(null);
                setStatus("idle");
                setMessage(
                  canImportOverviewYear(nextYear, lockedYears)
                    ? "Choose an Excel, Google Sheets export, or CSV file to import."
                    : `Import is disabled because ${nextYear} is locked. Unlock the year before importing.`
                );
              }}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}{lockedYears.includes(year) ? " (locked)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            Grade
            <select value={grade} onChange={(event) => setGrade(event.target.value)}>
              {SUPPORTED_GRADES.map((item) => (
                <option key={item} value={item}>
                  Grade {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label
          className={dragging ? "import-drop-zone is-dragging" : "import-drop-zone"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <span>Drop spreadsheet here</span>
          <strong>{file ? file.name : "No file selected"}</strong>
          <small>Supports .xlsx, .xls, .csv, and exported Google Sheets files.</small>
          <input
            accept=".xlsx,.xls,.csv,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            disabled={selectedYearLocked}
            type="file"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        </label>

        <div className={`import-status ${status}`} role="status">
          {message}
        </div>

        {result ? (
          <div className="import-results">
            <strong>Import complete</strong>
            <span>
              Imported {result.importedCount} student{result.importedCount === 1 ? "" : "s"} and {result.dataCellCount} assessment value
              {result.dataCellCount === 1 ? "" : "s"}.
            </span>
            {result.duplicateNames.length ? (
              <div className="import-duplicate-section">
                <div className="import-duplicate-heading">
                  <p>Duplicate names skipped for {result.schoolYear}:</p>
                  <button className="small-action" onClick={downloadDuplicateCsv} type="button">
                    Download CSV
                  </button>
                </div>
                <ul className="import-duplicate-list">
                  {result.duplicateNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <span>No duplicate student names were found for this year.</span>
            )}
          </div>
        ) : null}

        <div className="modal-actions">
          {result && status !== "reverted" ? (
            <>
              <button className="danger-action" disabled={status === "reverting"} onClick={revertImport} type="button">
                {status === "reverting" ? "Reverting..." : "Revert"}
              </button>
              <button className="primary-action" disabled={status === "reverting"} onClick={onClose} type="button">
                Confirm
              </button>
            </>
          ) : (
            <button className="primary-action" disabled={status === "importing" || selectedYearLocked} onClick={startImport} type="button">
              {status === "importing" ? "Importing..." : "Import"}
            </button>
          )}
        </div>
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
  const availableHomerooms = homerooms.filter((homeroom) => homeroom !== student?.homeroom);
  const [selectedHomeroom, setSelectedHomeroom] = useState(availableHomerooms[0] ?? "");

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

        {availableHomerooms.length ? (
          <label>
            Home room
            <select value={selectedHomeroom} onChange={(event) => setSelectedHomeroom(event.target.value)}>
              {availableHomerooms.map((homeroom) => (
                <option key={homeroom} value={homeroom}>
                  {homeroom}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="empty-state">No other homerooms exist in this grade. Add another homeroom before moving this student.</p>
        )}

        <button className="primary-action" disabled={!selectedHomeroom} onClick={() => onMove(selectedHomeroom)} type="button">
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

function AuditLog({
  events,
  importLogs,
  pendingAuditEventIds,
  retryingAuditEventId,
  onRetryAuditEvent,
  onRevertImport
}: {
  events: AppAuditEvent[];
  importLogs: ImportChangeLog[];
  pendingAuditEventIds: Set<string>;
  retryingAuditEventId: string | null;
  onRetryAuditEvent: (eventId: string) => Promise<void>;
  onRevertImport: (importLogId: string) => Promise<ImportRevertOutcome>;
}) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<AuditSortKey>("createdAt");
  const [revertingImportId, setRevertingImportId] = useState<string | null>(null);
  const [revertFeedback, setRevertFeedback] = useState<{
    kind: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const sortedEvents = useMemo(() => {
    const normalizedFilter = filter.toLowerCase();
    return sortAuditEvents(
      events.filter((event) =>
        [event.eventType, event.entityType, event.entityLabel, event.description, event.actor]
          .join(" ")
          .toLowerCase()
          .includes(normalizedFilter)
      ),
      sortKey
    );
  }, [events, filter, sortKey]);

  async function handleRevertImport(importLog: ImportChangeLog) {
    if (revertingImportId) return;
    setRevertingImportId(importLog.id);
    setRevertFeedback({ kind: "info", message: `Reverting ${importLog.fileName}...` });
    try {
      const outcome = await onRevertImport(importLog.id);
      if (outcome === "reverted") {
        setRevertFeedback({ kind: "success", message: `${importLog.fileName} was reverted and the rollback was saved.` });
      } else if (outcome === "cancelled") {
        setRevertFeedback({ kind: "info", message: "Revert cancelled. No import data was changed." });
      } else {
        setRevertFeedback({ kind: "error", message: "This import is already reverted or another rollback is in progress." });
      }
    } catch (error) {
      setRevertFeedback({
        kind: "error",
        message: `Revert failed. ${error instanceof Error ? error.message : "Please try again."}`
      });
    } finally {
      setRevertingImportId(null);
    }
  }

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
              <option value="actor">Actor</option>
            </select>
          </label>
        </div>

        {revertFeedback ? (
          <div
            className={`audit-revert-feedback ${revertFeedback.kind}`}
            role={revertFeedback.kind === "error" ? "alert" : "status"}
          >
            {revertFeedback.message}
          </div>
        ) : null}

        <div className="audit-table assessment-like-table" role="table" aria-label="Change logs">
          <div className="audit-table-row audit-table-head" role="row">
            <span>Event</span>
            <span>Entity</span>
            <span>Description</span>
            <span>Actor</span>
            <span>Date</span>
            <span>Action</span>
          </div>
          {sortedEvents.map((event) => {
            const importLog = event.importLogId ? importLogs.find((log) => log.id === event.importLogId) : null;
            const canRevert = Boolean(importLog && !importLog.revertedAt && event.eventType === "Imported spreadsheet");
            const auditPending = pendingAuditEventIds.has(event.id);
            return (
              <div className={auditPending ? "audit-table-row audit-pending-row" : "audit-table-row"} role="row" key={event.id}>
                <span className="audit-type">{event.eventType}</span>
                <span>{event.entityLabel}</span>
                <span>{event.revertedAt ? `${event.description} Reverted.` : event.description}</span>
                <span>{event.actor}</span>
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                <span>
                  {auditPending ? (
                    <button
                      className="small-action audit-retry-action"
                      disabled={Boolean(retryingAuditEventId)}
                      onClick={() => void onRetryAuditEvent(event.id)}
                      type="button"
                    >
                      {retryingAuditEventId === event.id ? "Retrying..." : "Retry audit"}
                    </button>
                  ) : canRevert && importLog ? (
                    <button
                      className="small-action audit-revert-action"
                      disabled={Boolean(revertingImportId)}
                      onClick={() => handleRevertImport(importLog)}
                      type="button"
                    >
                      {revertingImportId === importLog.id ? "Reverting..." : "Revert"}
                    </button>
                  ) : (
                    "-"
                  )}
                </span>
              </div>
            );
          })}
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
      return (
        <button
          className={studentNotes.length ? "notes-icon has-notes" : "notes-icon"}
          onClick={() => studentId && openNotes(studentId)}
          title={studentNotes.length ? "View student notes" : "Add student note"}
          type="button"
          aria-label={studentNotes.length ? "View student notes" : "Add student note"}
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
  studentOptions?: StudentIdentityOption[];
  onMoveStudent?: (studentId: string) => void;
  onDeleteStudent?: (studentId: string) => void;
  onStudentNameChange?: (studentId: string, studentName: string) => void;
  onSelectExistingStudent?: (placeholderId: string, existingStudentId: string) => void;
};

function StudentNameCellRenderer({
  data,
  value,
  locked = false,
  isDuplicate = false,
  studentOptions = [],
  onMoveStudent,
  onDeleteStudent,
  onStudentNameChange,
  onSelectExistingStudent
}: StudentNameCellRendererParams) {
  const studentId = data?.id;
  const displayValue = String(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(displayValue);
  const [focused, setFocused] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 260 });
  const suggestions = useMemo(() => {
    const normalizedDraft = normalizeStudentName(draft);
    if (!normalizedDraft || normalizedDraft === normalizeStudentName(displayValue)) return [];

    return studentOptions
      .filter((option) => option.id !== studentId && normalizeStudentName(option.name).includes(normalizedDraft))
      .slice(0, 6);
  }, [displayValue, draft, studentId, studentOptions]);

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

  function chooseSuggestion(option: StudentIdentityOption) {
    setDraft(option.name);
    if (studentId && option.id !== studentId) {
      onSelectExistingStudent?.(studentId, option.id);
    }
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
            {suggestions.map((option, index) => (
              <button
                className={index === 0 ? "active" : ""}
                key={option.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  chooseSuggestion(option);
                }}
                type="button"
              >
                <strong>{option.name}</strong>
                <small>{option.detail}</small>
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
  onSelectExistingStudent: (placeholderId: string, existingStudentId: string) => void,
  locked: boolean,
  duplicateStudentIds: string[] = [],
  studentOptions: StudentIdentityOption[] = []
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
      studentOptions,
      onMoveStudent,
      onDeleteStudent,
      onStudentNameChange,
      onSelectExistingStudent
    })
  };
}

type ScaleCodeCellEditorParams = ICellEditorParams<EntryRow, string | null> & {
  codes?: string[];
};

const ScaleCodeCellEditor = forwardRef(function ScaleCodeCellEditor(
  {
    value,
    eventKey,
    codes = [],
    onKeyDown: onGridKeyDown,
    stopEditing,
    column,
    node
  }: ScaleCodeCellEditorParams,
  ref
) {
  const normalizedCodes = useMemo(() => codes.map((code) => code.trim()).filter(Boolean), [codes]);
  const openingCharacter = printableEditorCharacter(eventKey);
  const [draft, setDraft] = useState(openingCharacter ?? String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useMemo(
    () => `scale-codes-${String(node.rowIndex ?? "row")}-${column.getColId().replace(/[^a-z0-9_-]/gi, "-")}`,
    [column, node.rowIndex]
  );

  useImperativeHandle(ref, () => ({
    afterGuiAttached() {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
    getValue() {
      return resolveScaleCodeEditorValue(draft, inputRef.current?.value, normalizedCodes).value;
    },
    getValidationErrors() {
      return resolveScaleCodeEditorValue(draft, inputRef.current?.value, normalizedCodes).validationErrors;
    }
  }), [draft, normalizedCodes]);

  return (
    <>
      <input
        ref={inputRef}
        aria-label="Scale code"
        className="scale-code-inline-input"
        list={listId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Tab" || event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onGridKeyDown(event.nativeEvent);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            stopEditing();
          }
        }}
      />
      <datalist id={listId}>
        {normalizedCodes.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
    </>
  );
});
function DefaultValueHeader({
  displayName,
  onOpenDefaultValue
}: {
  displayName?: string;
  onOpenDefaultValue?: () => void;
}) {
  return (
    <span className="field-header-with-default">
      <span className="field-header-label">{displayName}</span>
      {onOpenDefaultValue ? (
        <button
          aria-label={`Set default value for ${displayName ?? "field"}`}
          className="field-default-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenDefaultValue();
          }}
          title="Set default value"
          type="button"
        >
          +
        </button>
      ) : null}
    </span>
  );
}

function validateDefaultFieldValue(field: AssessmentFieldTemplate, rawValue: string, scaleCodes: string[]) {
  if (scaleCodes.length && (field.dataType === "letter" || field.dataType === "text")) {
    const value = validScaleCodeValue(rawValue, scaleCodes);
    if (!rawValue.trim() || value) return { valid: true as const, value, error: null };
    return {
      valid: false as const,
      value: null,
      error: `${field.name} must be one of: ${scaleCodes.join(", ")}.`
    };
  }
  return validateAssessmentValue(rawValue, field);
}

function fieldColumn(
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  section?: AssessmentSectionTemplate,
  extraCellClass = "",
  _commitScaleCodeValue?: (rowId: string, fieldName: string, nextValue: string | null) => void,
  openDefaultValuePopup?: (target: DefaultValueTarget) => void,
  context: { schoolYear?: string; grade?: string } = {}
): ColDef<EntryRow> {
  const fieldName = assessmentValueKey(assessment, round, field, section);
  const scaleCodes = scaleCodesForField(field);
  const usesScaleCodeEditor = !field.isCalculated && (field.dataType === "letter" || field.dataType === "text") && scaleCodes.length > 0;
  const editable = isEditableAssessmentField(assessment, field);
  const canBulkDefault = editable;
  const defaultValueTarget = {
    fieldName,
    field,
    label: [round.label, section?.name, field.name].filter(Boolean).join(" / "),
    scaleCodes
  };
  const scaleCodeParams = usesScaleCodeEditor
    ? { codes: scaleCodes }
    : undefined;
  const numberEditorParams = field.dataType === "integer" || field.dataType === "percentage"
    ? (params: { data: EntryRow }) => ({
        min: field.validationConfig?.min ?? 0,
        max: field.validationConfig?.max ?? (field.dataType === "percentage" ? 100 : Number.MAX_SAFE_INTEGER),
        precision: field.dataType === "integer" ? 0 : field.validationConfig?.precision,
        step: field.dataType === "integer" ? 1 : undefined,
        preventStepping: true,
        getValidationErrors: ({ value }: { value: unknown }) => {
          const validation = validateAssessmentTableEdit(params.data, assessment, fieldName, value, context);
          return validation.valid ? null : [validation.error];
        }
      })
    : undefined;
  return {
    colId: fieldName,
    headerName: field.name,
    headerComponent: DefaultValueHeader,
    headerComponentParams: {
      onOpenDefaultValue: canBulkDefault && openDefaultValuePopup ? () => openDefaultValuePopup(defaultValueTarget) : undefined
    },
    width: field.name.length > 12 ? 150 : 104,
    cellDataType: usesScaleCodeEditor ? false : undefined,
    editable,
    singleClickEdit: usesScaleCodeEditor,
    cellEditor: usesScaleCodeEditor
      ? ScaleCodeCellEditor
      : field.dataType === "integer" || field.dataType === "percentage"
        ? "agNumberCellEditor"
        : undefined,
    cellEditorParams: scaleCodeParams ?? numberEditorParams,
    cellRenderer: field.displayStyle === "checkbox"
      ? (params: { value?: unknown }) => (
          params.value == null
            ? <span className="calculated-checkbox pending" aria-label={`${field.name} not yet calculated`} />
            : <input
                aria-label={field.name}
                checked={params.value === true || params.value === 1}
                className="calculated-checkbox"
                disabled
                type="checkbox"
              />
        )
      : undefined,
    valueGetter: (params) => params.data?.[fieldName] ?? null,
    valueSetter: (params) => {
      if (!params.data) return false;
      const validation = usesScaleCodeEditor
        ? validateDefaultFieldValue(field, String(params.newValue ?? ""), scaleCodes)
        : validateAssessmentTableEdit(params.data, assessment, fieldName, params.newValue, context);
      if (!validation.valid) return false;
      const nextValue = validation.value;
      if (params.data[fieldName] === nextValue) return false;
      params.data[fieldName] = nextValue;
      return true;
    },
    valueParser: (params) => {
      if (field.dataType !== "integer" && field.dataType !== "percentage") return params.newValue;
      if (!params.data) return params.oldValue;
      const validation = validateAssessmentTableEdit(params.data, assessment, fieldName, params.newValue, context);
      return validation.valid ? validation.value : params.oldValue;
    },
    cellClass: ["assessment-data-cell", editable ? "editable-score-cell" : "locked-formula-cell", extraCellClass]
      .filter(Boolean)
      .join(" "),
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
  hiddenFieldIds: string[] = [],
  hiddenSectionIds: string[] = [],
  commitScaleCodeValue?: (rowId: string, fieldName: string, nextValue: string | null) => void,
  openDefaultValuePopup?: (target: DefaultValueTarget) => void,
  context: { schoolYear?: string; grade?: string } = {}
): ColDef<EntryRow>[] {
  const fieldsForRound = assessment.fields.filter(
    (field) =>
      assessmentFieldAppliesToGrade(field, context.grade) &&
      !hiddenFieldIds.includes(field.id) &&
      (!field.roundIds?.length || field.roundIds.includes(round.id))
  );
  const sectionsForRound = sectionsForAssessmentRound(assessment, round, context.grade)
    .filter((section) => !hiddenSectionIds.includes(section.id));
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
            section,
            index === sectionFields.length - 1 ? "hierarchy-boundary-cell" : "",
            commitScaleCodeValue,
            openDefaultValuePopup,
            context
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
        undefined,
        index === unsectionedFields.length - 1 ? "hierarchy-boundary-cell" : "",
        commitScaleCodeValue,
        openDefaultValuePopup,
        context
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

function normalizeStudentName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function overviewRowsForSelection(
  rows: OrfResultRow[],
  placements: StudentPlacement[],
  selectedYear: string,
  selectedGrade: string
) {
  return placements
    .filter((placement) => placement.schoolYear === selectedYear && placement.grade === selectedGrade)
    .map((placement) => {
      const row = rows.find((studentRow) => studentRow.id === placement.studentId);
      return row ? { ...row, homeroom: placement.homeroom } : null;
    })
    .filter((row): row is OrfResultRow => Boolean(row));
}

function findOverviewStudentNameConflicts(
  rows: OrfResultRow[],
  selectedYear: string,
  selectedGrade: string,
  savedState: WorkspaceStudentSnapshot | null,
  changedStudentIds: Set<string>
) {
  if (!changedStudentIds.size) return [];
  if (!savedState) return [];

  const savedRowsById = new Map(savedState.rows.map((row) => [row.id, row]));
  const savedPlacementsForYear = savedState.placements.filter((placement) => placement.schoolYear === selectedYear);
  const conflicts: DuplicateStudentNameConflict[] = [];
  const seenConflictKeys = new Set<string>();

  rows.forEach((row) => {
    if (!changedStudentIds.has(row.id)) return;
    const normalizedName = normalizeStudentName(row.student);
    if (!normalizedName) return;

    const savedRow = savedRowsById.get(row.id);
    const savedPlacement = savedPlacementsForYear.find(
      (placement) =>
        placement.studentId === row.id &&
        placement.grade === selectedGrade &&
        placement.homeroom === row.homeroom
    );
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

function newAuditEventId() {
  const randomId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `audit-${randomId}`;
}

function authenticatedActorName(user: User | null) {
  return user?.displayName?.trim()
    || user?.email?.split("@")[0]
    || user?.email
    || "Authenticated user";
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function safeCalculationKey(key?: string): string {
  return predefinedCalculations.find((calculation) => calculation.key === key)?.key ?? defaultCalculationKey;
}

function calculationLabel(key?: string) {
  return predefinedCalculations.find((calculation) => calculation.key === key)?.label ?? key ?? "";
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
