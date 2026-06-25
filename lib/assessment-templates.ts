export type AssessmentDataType = "integer" | "percentage" | "letter" | "text" | "date" | "file" | "calculated";
export type Visibility = "evaluators" | "vice-principal" | "admin";

export type AssessmentFieldTemplate = {
  id: string;
  name: string;
  slug: string;
  dataType: AssessmentDataType;
  groupLabel?: string;
  roundIds?: string[];
  sectionIds?: string[];
  isRequired: boolean;
  isCalculated: boolean;
  calculationKey?: string;
  calculationExpression?: string;
  calculationCondition?: unknown;
  letterRanks?: string;
  visibility: Visibility;
};

export type AssessmentRoundTemplate = {
  id: string;
  label: string;
  month: string;
  color?: string;
};

export type AssessmentSectionTemplate = {
  id: string;
  name: string;
  roundIds: string[];
};

export type AssessmentTemplate = {
  id: string;
  name: string;
  category: "Literacy" | "Numeracy" | "Reports" | "Custom";
  description: string;
  gradeScope: string;
  rounds: AssessmentRoundTemplate[];
  sections?: AssessmentSectionTemplate[];
  fields: AssessmentFieldTemplate[];
};

export const defaultRounds: AssessmentRoundTemplate[] = [
  { id: "fall", label: "September / Fall", month: "September", color: "#ffe3d8" },
  { id: "winter", label: "January / Winter", month: "January", color: "#dceeff" },
  { id: "spring", label: "May / Spring", month: "May", color: "#def5df" }
];

export const assessmentTemplates: AssessmentTemplate[] = [
  {
    id: "orf",
    name: "Oral Reading Fluency",
    category: "Literacy",
    description: "Tracks WPM, EPM, CWPM, median, and percentile across three passages per round.",
    gradeScope: "Grades 3-12",
    rounds: defaultRounds,
    sections: [
      { id: "passage-1", name: "1st passage", roundIds: ["fall", "winter", "spring"] },
      { id: "passage-2", name: "2nd passage", roundIds: ["fall", "winter", "spring"] },
      { id: "passage-3", name: "3rd passage", roundIds: ["fall", "winter", "spring"] }
    ],
    fields: [
      {
        id: "wpm",
        name: "WPM",
        slug: "wpm",
        dataType: "integer",
        groupLabel: "Passages",
        sectionIds: ["passage-1", "passage-2", "passage-3"],
        isRequired: false,
        isCalculated: false,
        visibility: "evaluators"
      },
      {
        id: "epm",
        name: "EPM",
        slug: "epm",
        dataType: "integer",
        groupLabel: "Passages",
        sectionIds: ["passage-1", "passage-2", "passage-3"],
        isRequired: false,
        isCalculated: false,
        visibility: "evaluators"
      },
      {
        id: "cwpm",
        name: "CWPM",
        slug: "cwpm",
        dataType: "calculated",
        groupLabel: "Passages",
        sectionIds: ["passage-1", "passage-2", "passage-3"],
        isRequired: false,
        isCalculated: true,
        calculationKey: "orf_cwpm",
        visibility: "evaluators"
      },
      {
        id: "median",
        name: "Med",
        slug: "median",
        dataType: "calculated",
        isRequired: false,
        isCalculated: true,
        calculationKey: "median",
        visibility: "evaluators"
      },
      {
        id: "percentile",
        name: "%ile",
        slug: "percentile",
        dataType: "calculated",
        isRequired: false,
        isCalculated: true,
        calculationKey: "orf_percentile",
        visibility: "evaluators"
      }
    ]
  },
  {
    id: "quick-write",
    name: "Quick Write",
    category: "Literacy",
    description: "Captures TWW, WSC, CWS, and percentile by assessment round.",
    gradeScope: "Grades 3-12",
    rounds: defaultRounds,
    fields: [
      {
        id: "tww",
        name: "TWW",
        slug: "tww",
        dataType: "integer",
        isRequired: false,
        isCalculated: false,
        visibility: "evaluators"
      },
      {
        id: "wsc",
        name: "WSC",
        slug: "wsc",
        dataType: "integer",
        isRequired: false,
        isCalculated: false,
        visibility: "evaluators"
      },
      {
        id: "cws",
        name: "CWS",
        slug: "cws",
        dataType: "integer",
        isRequired: false,
        isCalculated: false,
        visibility: "evaluators"
      },
      {
        id: "quick-write-percentile",
        name: "%ile",
        slug: "percentile",
        dataType: "calculated",
        isRequired: false,
        isCalculated: true,
        calculationKey: "quick_write_percentile",
        visibility: "evaluators"
      }
    ]
  },
  {
    id: "ab-ed-numeracy",
    name: "AB Ed Numeracy",
    category: "Numeracy",
    description: "Mandatory numeracy screener with score and total fields for each domain.",
    gradeScope: "Grades 3-5",
    rounds: defaultRounds,
    fields: [
      "Comparing Numbers",
      "Writing Numbers",
      "Number Line",
      "Addition",
      "Subtraction",
      "Equations",
      "Ordering Numbers"
    ].flatMap((name) => [
      {
        id: `${name.toLowerCase().replaceAll(" ", "-")}-score`,
        name: `${name} score`,
        slug: `${name.toLowerCase().replaceAll(" ", "_")}_score`,
        dataType: "integer" as const,
        groupLabel: name,
        isRequired: false,
        isCalculated: false,
        visibility: "evaluators" as const
      },
      {
        id: `${name.toLowerCase().replaceAll(" ", "-")}-total`,
        name: `${name} total`,
        slug: `${name.toLowerCase().replaceAll(" ", "_")}_total`,
        dataType: "integer" as const,
        groupLabel: name,
        isRequired: false,
        isCalculated: false,
        visibility: "vice-principal" as const
      }
    ])
  },
  {
    id: "star-reading",
    name: "Star Reading",
    category: "Reports",
    description: "Stores linked or uploaded Star Reading reports rather than fixed score columns.",
    gradeScope: "Grades 3-12",
    rounds: defaultRounds,
    fields: [
      {
        id: "report-file",
        name: "Report file",
        slug: "report_file",
        dataType: "file",
        isRequired: false,
        isCalculated: false,
        visibility: "evaluators"
      }
    ]
  }
];

export const emptyCustomTemplate: AssessmentTemplate = {
  id: "custom",
  name: "New Custom Assessment",
  category: "Custom",
  description: "Define a new assessment with custom fields, rounds, and visibility rules.",
  gradeScope: "Custom",
  rounds: defaultRounds,
  sections: [],
  fields: []
};

export function normalizeAssessmentTemplates(templates: AssessmentTemplate[]) {
  return templates.map((template) => {
    if (template.id !== "quick-write") return template;

    return {
      ...template,
      fields: template.fields.map((field) => {
        const isQuickWritePercentile =
          field.calculationKey === "quick_write_percentile" ||
          field.id === "quick-write-percentile" ||
          field.slug === "percentile" ||
          field.name.trim().toLowerCase() === "%ile";

        return isQuickWritePercentile
          ? {
              ...field,
              dataType: "calculated" as const,
              isCalculated: true,
              calculationKey: "quick_write_percentile"
            }
          : field;
      })
    };
  });
}
