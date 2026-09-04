import {
  ORF_PERCENTILE_CALCULATION_KEYS,
  resolveOrfPercentileCalculationKey,
  type OrfPercentileWindow
} from "@/lib/orf-calculations";
import {
  PROVINCIAL_NUMERACY_NORMS,
  type NumeracyComponent
} from "@/lib/provincial-screening-norms";

export type AssessmentDataType = "integer" | "percentage" | "letter" | "text" | "date" | "file" | "calculated";
export type Visibility = "evaluators" | "vice-principal" | "admin";

export type AssessmentFieldValidationConfig = {
  min?: number;
  max?: number;
  precision?: number;
};

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
  gradeIds?: string[];
  displayStyle?: "checkbox";
  letterRanks?: string;
  validationConfig?: AssessmentFieldValidationConfig;
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
  gradeIds?: string[];
};

export type AssessmentDefinitionSnapshot = {
  name: string;
  description: string;
  gradeScope: string;
  rounds: AssessmentRoundTemplate[];
  sections?: AssessmentSectionTemplate[];
  fields: AssessmentFieldTemplate[];
};

export type AssessmentTemplate = {
  id: string;
  name: string;
  category: "Literacy" | "Numeracy" | "Reports" | "Custom";
  description: string;
  gradeScope: string;
  definitionYears?: string[];
  yearDefinitions?: Record<string, AssessmentDefinitionSnapshot>;
  rounds: AssessmentRoundTemplate[];
  sections?: AssessmentSectionTemplate[];
  fields: AssessmentFieldTemplate[];
};

export const defaultRounds: AssessmentRoundTemplate[] = [
  { id: "fall", label: "September / Fall", month: "September", color: "#ffe3d8" },
  { id: "winter", label: "January / Winter", month: "January", color: "#dceeff" },
  { id: "spring", label: "May / Spring", month: "May", color: "#def5df" }
];

const supportedNormGrades = ["3", "4"];

const numeracyFieldGroups: Array<{ name: string; component: NumeracyComponent; gradeIds: string[] }> = [
  { name: "Comparing Numbers", component: "comparing_numbers", gradeIds: ["3"] },
  { name: "Writing Numbers", component: "writing_numbers", gradeIds: ["3", "4"] },
  { name: "Number Line", component: "number_line", gradeIds: ["3", "4"] },
  { name: "Addition", component: "number_facts_addition", gradeIds: ["3"] },
  { name: "Subtraction", component: "number_facts_subtraction", gradeIds: ["3"] },
  { name: "Equations", component: "equations", gradeIds: ["3", "4"] },
  { name: "Ordering Numbers", component: "ordering_numbers", gradeIds: ["3"] },
  { name: "Number Facts Addition and Subtraction", component: "number_facts_addition_subtraction", gradeIds: ["4"] },
  { name: "Number Facts Multiplication and Division", component: "number_facts_multiplication_division", gradeIds: ["4"] },
  { name: "Calculation Addition", component: "calculation_addition", gradeIds: ["4"] },
  { name: "Calculation Subtraction", component: "calculation_subtraction", gradeIds: ["4"] },
  { name: "Fractions", component: "fractions", gradeIds: ["4"] }
];

function idForLabel(name: string) {
  return name.toLowerCase().replaceAll(" ", "-");
}

function slugForLabel(name: string) {
  return name.toLowerCase().replaceAll(" ", "_");
}

function provincialNumeracyFields(): AssessmentFieldTemplate[] {
  return [
    ...numeracyFieldGroups.flatMap(({ name, component, gradeIds }) => [
      {
        id: `${idForLabel(name)}-score`,
        name: `${name} score`,
        slug: `${slugForLabel(name)}_score`,
        dataType: "integer" as const,
        groupLabel: name,
        gradeIds,
        isRequired: false,
        isCalculated: false,
        calculationCondition: { component },
        visibility: "evaluators" as const
      },
      {
        id: `${idForLabel(name)}-total`,
        name: `${name} total`,
        slug: `${slugForLabel(name)}_total`,
        dataType: "calculated" as const,
        groupLabel: name,
        gradeIds,
        isRequired: false,
        isCalculated: true,
        calculationKey: "provincial_numeracy_component_total",
        calculationCondition: { component },
        visibility: "vice-principal" as const
      }
    ]),
    {
      id: "weighted-total-score",
      name: "Weighted Total",
      slug: "weighted_total_score",
      dataType: "calculated",
      gradeIds: supportedNormGrades,
      isRequired: false,
      isCalculated: true,
      calculationKey: "provincial_numeracy_weighted_score",
      visibility: "evaluators"
    },
    {
      id: "requires-additional-supports",
      name: "Requires Support",
      slug: "requires_additional_supports",
      dataType: "calculated",
      gradeIds: supportedNormGrades,
      displayStyle: "checkbox",
      isRequired: false,
      isCalculated: true,
      calculationKey: "provincial_numeracy_requires_support",
      visibility: "evaluators"
    }
  ];
}

export const assessmentTemplates: AssessmentTemplate[] = [
  {
    id: "orf",
    name: "Oral Reading Fluency",
    category: "Literacy",
    description: "Tracks WPM, EPM, CWPM, median, and percentile across three passages per round.",
    gradeScope: "Grades 1-6",
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
        id: "percentile-fall",
        name: "%ile",
        slug: "percentile-fall",
        dataType: "calculated",
        roundIds: ["fall"],
        isRequired: false,
        isCalculated: true,
        calculationKey: ORF_PERCENTILE_CALCULATION_KEYS.fall,
        visibility: "evaluators"
      },
      {
        id: "percentile-winter",
        name: "%ile",
        slug: "percentile-winter",
        dataType: "calculated",
        roundIds: ["winter"],
        isRequired: false,
        isCalculated: true,
        calculationKey: ORF_PERCENTILE_CALCULATION_KEYS.winter,
        visibility: "evaluators"
      },
      {
        id: "percentile-spring",
        name: "%ile",
        slug: "percentile-spring",
        dataType: "calculated",
        roundIds: ["spring"],
        isRequired: false,
        isCalculated: true,
        calculationKey: ORF_PERCENTILE_CALCULATION_KEYS.spring,
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
    id: "cc3",
    name: "CC3",
    category: "Literacy",
    description: "Castles & Coltheart 3 word-reading screener with provincial support norms.",
    gradeScope: "Grades 3-4",
    rounds: defaultRounds,
    sections: [
      { id: "regular", name: "Regular Words", roundIds: ["fall", "winter", "spring"], gradeIds: supportedNormGrades },
      { id: "irregular", name: "Irregular Words", roundIds: ["fall", "winter", "spring"], gradeIds: supportedNormGrades },
      { id: "nonword", name: "Non-words", roundIds: ["fall", "winter", "spring"], gradeIds: supportedNormGrades }
    ],
    fields: [
      {
        id: "score",
        name: "Score",
        slug: "score",
        dataType: "integer",
        sectionIds: ["regular", "irregular", "nonword"],
        gradeIds: supportedNormGrades,
        validationConfig: { min: 0, max: 40 },
        isRequired: false,
        isCalculated: false,
        visibility: "evaluators"
      },
      {
        id: "total",
        name: "Total",
        slug: "total",
        dataType: "calculated",
        sectionIds: ["regular", "irregular", "nonword"],
        gradeIds: supportedNormGrades,
        isRequired: false,
        isCalculated: true,
        calculationKey: "cc3_component_total",
        visibility: "evaluators"
      },
      {
        id: "requires-additional-supports",
        name: "Requires Support",
        slug: "requires_additional_supports",
        dataType: "calculated",
        gradeIds: supportedNormGrades,
        displayStyle: "checkbox",
        isRequired: false,
        isCalculated: true,
        calculationKey: "cc3_requires_support",
        visibility: "evaluators"
      }
    ]
  },
  {
    id: "ab-ed-numeracy",
    name: "AB Ed Numeracy",
    category: "Numeracy",
    description: "Provincial numeracy screener with grade- and window-specific totals and support norms.",
    gradeScope: "Grades 3-4",
    rounds: defaultRounds,
    fields: provincialNumeracyFields()
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
  const normalized = templates.map((template) => normalizeTemplateAndYearDefinitions(template));

  for (const requiredId of ["cc3", "ab-ed-numeracy"]) {
    if (normalized.some((template) => template.id === requiredId)) continue;
    const defaultTemplate = assessmentTemplates.find((template) => template.id === requiredId);
    if (defaultTemplate) normalized.push(defaultTemplate);
  }
  return normalized;
}

function normalizeTemplateAndYearDefinitions(template: AssessmentTemplate) {
  const normalizedTemplate = normalizeSingleAssessmentTemplate({ ...template, yearDefinitions: undefined });
  if (!template.yearDefinitions) return normalizedTemplate;

  const yearDefinitions = Object.fromEntries(Object.entries(template.yearDefinitions).map(([year, snapshot]) => {
    const normalizedSnapshot = normalizeSingleAssessmentTemplate({
      ...template,
      ...snapshot,
      definitionYears: [year],
      yearDefinitions: undefined
    });
    return [year, assessmentDefinitionSnapshot(normalizedSnapshot)];
  }));
  return { ...normalizedTemplate, yearDefinitions };
}

function normalizeSingleAssessmentTemplate(template: AssessmentTemplate): AssessmentTemplate {
  const normalizedTemplate = template.id === "orf"
    ? normalizeOrfTemplate(template)
    : template;

  if (normalizedTemplate.id === "cc3") return normalizeCc3Template(normalizedTemplate);
  if (normalizedTemplate.id === "ab-ed-numeracy") return normalizeProvincialNumeracyTemplate(normalizedTemplate);
  if (normalizedTemplate.id !== "quick-write") return normalizedTemplate;

  return {
    ...normalizedTemplate,
    fields: normalizedTemplate.fields.map((field) => {
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
}

function normalizeOrfTemplate(template: AssessmentTemplate): AssessmentTemplate {
  return {
    ...template,
    gradeScope: "Grades 1-6",
    fields: normalizeLegacyOrfPercentileFields(template).map((field) =>
      isOrfCwpmField(field)
        ? {
            ...field,
            dataType: "calculated" as const,
            isCalculated: true,
            calculationKey: "orf_cwpm"
          }
        : field
    )
  };
}

function isOrfCwpmField(field: AssessmentFieldTemplate) {
  return [field.calculationKey, field.slug, field.id, field.name]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""))
    .some((value) => value === "orf_cwpm" || value === "cwpm");
}

function assessmentDefinitionSnapshot(template: AssessmentTemplate): AssessmentDefinitionSnapshot {
  return {
    name: template.name,
    description: template.description,
    gradeScope: template.gradeScope,
    rounds: template.rounds,
    sections: template.sections,
    fields: template.fields
  };
}

function normalizeCc3Template(template: AssessmentTemplate): AssessmentTemplate {
  const sections = template.sections?.length
    ? template.sections.map((section) => ({ ...section, gradeIds: supportedNormGrades }))
    : assessmentTemplates.find((candidate) => candidate.id === "cc3")?.sections;
  const sectionIds = sections?.map((section) => section.id) ?? [];
  const scoreField = template.fields.find((field) => field.id === "score" || field.slug === "score");
  const totalField = template.fields.find((field) => field.id === "total" || field.slug === "total");
  if (!scoreField || !totalField || !sectionIds.length) {
    return assessmentTemplates.find((candidate) => candidate.id === "cc3") ?? template;
  }

  const otherFields = template.fields.filter((field) => field !== scoreField && field !== totalField && field.calculationKey !== "cc3_requires_support");
  return {
    ...template,
    description: "Castles & Coltheart 3 word-reading screener with provincial support norms.",
    gradeScope: "Grades 3-4",
    sections,
    fields: [
      { ...scoreField, sectionIds, gradeIds: supportedNormGrades, validationConfig: { min: 0, max: 40 } },
      {
        ...totalField,
        dataType: "calculated",
        sectionIds,
        gradeIds: supportedNormGrades,
        isCalculated: true,
        calculationKey: "cc3_component_total"
      },
      ...otherFields,
      {
        id: "requires-additional-supports",
        name: "Requires Support",
        slug: "requires_additional_supports",
        dataType: "calculated",
        gradeIds: supportedNormGrades,
        displayStyle: "checkbox",
        isRequired: false,
        isCalculated: true,
        calculationKey: "cc3_requires_support",
        visibility: "evaluators"
      }
    ]
  };
}

function normalizeProvincialNumeracyTemplate(template: AssessmentTemplate): AssessmentTemplate {
  if (!template.sections?.length) {
    return {
      ...template,
      description: "Provincial numeracy screener with grade- and window-specific totals and support norms.",
      gradeScope: "Grades 3-4",
      fields: provincialNumeracyFields()
    };
  }

  const recognizedSections = template.sections.flatMap((section) => {
    const componentName = componentForLegacyNumeracySection(section.name);
    if (!componentName) return [];
    return [{ ...section, gradeIds: gradesForNumeracyComponent(componentName) }];
  });
  const existingComponents = new Set(recognizedSections.map((section) => componentForLegacyNumeracySection(section.name)));
  const missingSections = numeracyFieldGroups
    .filter((group) => !existingComponents.has(group.component))
    .map((group) => ({
      id: slugForLabel(group.name),
      name: group.name,
      roundIds: template.rounds.map((round) => round.id),
      gradeIds: group.gradeIds
    }));
  const sections = [...recognizedSections, ...missingSections];
  const sectionIds = sections.map((section) => section.id);
  const scoreField = template.fields.find((field) => field.id === "score" || field.slug === "score");
  const totalField = template.fields.find((field) => field.id === "total" || field.slug === "total");
  if (!scoreField || !totalField) {
    return { ...template, gradeScope: "Grades 3-4", fields: provincialNumeracyFields() };
  }
  const otherFields = template.fields.filter((field) =>
    field !== scoreField &&
    field !== totalField &&
    field.calculationKey !== "provincial_numeracy_weighted_score" &&
    field.calculationKey !== "provincial_numeracy_requires_support"
  );

  return {
    ...template,
    description: "Provincial numeracy screener with grade- and window-specific totals and support norms.",
    gradeScope: "Grades 3-4",
    sections,
    fields: [
      { ...scoreField, sectionIds },
      {
        ...totalField,
        dataType: "calculated",
        sectionIds,
        isCalculated: true,
        calculationKey: "provincial_numeracy_component_total"
      },
      ...otherFields,
      {
        id: "weighted-total-score",
        name: "Weighted Total",
        slug: "weighted_total_score",
        dataType: "calculated",
        gradeIds: supportedNormGrades,
        isRequired: false,
        isCalculated: true,
        calculationKey: "provincial_numeracy_weighted_score",
        visibility: "evaluators"
      },
      {
        id: "requires-additional-supports",
        name: "Requires Support",
        slug: "requires_additional_supports",
        dataType: "calculated",
        gradeIds: supportedNormGrades,
        displayStyle: "checkbox",
        isRequired: false,
        isCalculated: true,
        calculationKey: "provincial_numeracy_requires_support",
        visibility: "evaluators"
      }
    ]
  };
}

function componentForLegacyNumeracySection(name: string): NumeracyComponent | null {
  const normalized = slugForLabel(name);
  if (normalized.includes("comparing_numbers")) return "comparing_numbers";
  if (normalized.includes("writing_numbers")) return "writing_numbers";
  if (normalized.includes("number_line")) return "number_line";
  if (normalized === "addition") return "number_facts_addition";
  if (normalized === "subtraction") return "number_facts_subtraction";
  if (normalized.includes("multiplication") && normalized.includes("division")) return "number_facts_multiplication_division";
  if (normalized.includes("addition") && normalized.includes("subtraction")) return "number_facts_addition_subtraction";
  if (normalized.includes("calculation_addition")) return "calculation_addition";
  if (normalized.includes("calculation_subtraction")) return "calculation_subtraction";
  if (normalized.includes("equations")) return "equations";
  if (normalized.includes("ordering")) return "ordering_numbers";
  if (normalized.includes("fractions")) return "fractions";
  return null;
}

function gradesForNumeracyComponent(componentName: NumeracyComponent) {
  return supportedNormGrades.filter((grade) =>
    Object.values(PROVINCIAL_NUMERACY_NORMS).some((window) =>
      window[grade]?.components.some((component) => component.component === componentName)
    )
  );
}

function normalizeLegacyOrfPercentileFields(template: AssessmentTemplate) {
  return template.fields.flatMap((field) => {
    if (field.calculationKey === "orf_percentile") {
      const supportedRounds = template.rounds.filter((round) => {
        const isSupportedWindow = round.id in ORF_PERCENTILE_CALCULATION_KEYS;
        const isAssignedToField = !field.roundIds?.length || field.roundIds.includes(round.id);
        return isSupportedWindow && isAssignedToField;
      });
      if (!supportedRounds.length) return [field];

      return supportedRounds.map((round) => ({
        ...field,
        id: `${field.id}-${round.id}`,
        slug: `${field.slug}-${round.id}`,
        roundIds: [round.id],
        calculationKey: ORF_PERCENTILE_CALCULATION_KEYS[round.id as OrfPercentileWindow]
      }));
    }

    const seasonalWindow = (Object.keys(ORF_PERCENTILE_CALCULATION_KEYS) as OrfPercentileWindow[])
      .find((window) => Boolean(resolveOrfPercentileCalculationKey(field.calculationKey, window)));
    if (!seasonalWindow) return [field];

    return [{
      ...field,
      roundIds: [seasonalWindow],
      calculationKey: ORF_PERCENTILE_CALCULATION_KEYS[seasonalWindow]
    }];
  });
}
