export type ScreeningWindow = "fall" | "winter" | "spring";

export type Cc3Component = "regular_words" | "irregular_words" | "non_words";

export type Cc3Norm = Record<Cc3Component, { max: 40; requiringSupportMax: number }>;

export const CC3_NORMS: Record<ScreeningWindow, Partial<Record<string, Cc3Norm>>> = {
  fall: {
    "2": cc3Norm(7, 3, 2),
    "3": cc3Norm(21, 12, 7),
    "4": cc3Norm(27, 17, 10)
  },
  winter: {
    "1": cc3Norm(3, 0, 1),
    "2": cc3Norm(17, 8, 7),
    "3": cc3Norm(28, 16, 13),
    "4": cc3Norm(29, 18, 12)
  },
  spring: {
    "1": cc3Norm(7, 3, 3),
    "2": cc3Norm(20, 11, 9),
    "3": cc3Norm(28, 18, 13),
    "4": cc3Norm(31, 21, 17)
  }
};

function cc3Norm(
  regularWordsSupportMax: number,
  irregularWordsSupportMax: number,
  nonWordsSupportMax: number
): Cc3Norm {
  return {
    regular_words: { max: 40, requiringSupportMax: regularWordsSupportMax },
    irregular_words: { max: 40, requiringSupportMax: irregularWordsSupportMax },
    non_words: { max: 40, requiringSupportMax: nonWordsSupportMax }
  };
}

export type NumeracyComponent =
  | "rote_counting"
  | "counting_sets"
  | "next_number"
  | "naming_numbers"
  | "comparing_numbers"
  | "writing_numbers"
  | "number_line"
  | "number_facts_addition"
  | "number_facts_subtraction"
  | "number_facts_addition_subtraction"
  | "number_facts_multiplication_division"
  | "equations"
  | "ordering_numbers"
  | "calculation_addition"
  | "calculation_subtraction"
  | "fractions";

export type NumeracyComponentNorm = {
  component: NumeracyComponent;
  max: number;
  weight: number;
  requiringSupportMax: number;
};

export type NumeracyNorm = {
  components: NumeracyComponentNorm[];
  weightedSupportMax: number;
};

const component = (
  componentName: NumeracyComponent,
  max: number,
  weight: number,
  requiringSupportMax: number
): NumeracyComponentNorm => ({ component: componentName, max, weight, requiringSupportMax });

export const PROVINCIAL_NUMERACY_NORMS: Record<ScreeningWindow, Partial<Record<string, NumeracyNorm>>> = {
  fall: {
    "1": numeracyNorm(22, [
      component("rote_counting", 100, 10, 26), component("next_number", 7, 10, 2),
      component("naming_numbers", 18, 15, 6), component("comparing_numbers", 40, 15, 6),
      component("writing_numbers", 15, 15, 2), component("number_line", 8, 15, 0),
      component("number_facts_addition", 39, 10, 1), component("number_facts_subtraction", 39, 10, 0)
    ]),
    "2": numeracyNorm(29, grade2Components(12, 7, 1, 5, 2, 14)),
    "3": numeracyNorm(39, grade3Components(17, 8, 3, 8, 5, 3, 20)),
    "4": numeracyNorm(28, grade4Components(7, 5, 7, 1, 5, 5, 3, 1))
  },
  winter: {
    "K": numeracyNorm(37, [
      component("rote_counting", 100, 15, 14), component("counting_sets", 10, 15, 8),
      component("naming_numbers", 18, 30, 4), component("comparing_numbers", 40, 30, 9),
      component("number_line", 8, 10, 2)
    ]),
    "1": numeracyNorm(43, [
      component("rote_counting", 100, 10, 60), component("next_number", 7, 10, 4),
      component("naming_numbers", 18, 15, 12), component("comparing_numbers", 40, 15, 11),
      component("writing_numbers", 15, 15, 7), component("number_line", 8, 15, 1),
      component("number_facts_addition", 39, 10, 3), component("number_facts_subtraction", 39, 10, 0)
    ]),
    "2": numeracyNorm(39, grade2Components(15, 10, 2, 7, 4, 19)),
    "3": numeracyNorm(48, grade3Components(19, 10, 4, 10, 6, 4, 24)),
    "4": numeracyNorm(35, grade4Components(8, 7, 10, 2, 6, 8, 5, 1))
  },
  spring: {
    "1": numeracyNorm(54, [
      component("rote_counting", 100, 10, 99), component("next_number", 7, 10, 5),
      component("naming_numbers", 18, 15, 13), component("comparing_numbers", 40, 15, 13),
      component("writing_numbers", 15, 15, 10), component("number_line", 8, 15, 2),
      component("number_facts_addition", 39, 10, 5), component("number_facts_subtraction", 39, 10, 2)
    ]),
    "2": numeracyNorm(42, grade2Components(16, 10, 3, 8, 5, 20)),
    "3": numeracyNorm(49, grade3Components(19, 10, 4, 11, 7, 5, 25)),
    "4": numeracyNorm(41, grade4Components(8, 7, 10, 4, 8, 9, 6, 2))
  }
};

function numeracyNorm(weightedSupportMax: number, components: NumeracyComponentNorm[]): NumeracyNorm {
  return { components, weightedSupportMax };
}

function grade2Components(
  comparing: number, writing: number, numberLine: number, addition: number, subtraction: number, ordering: number
) {
  return [
    component("comparing_numbers", 40, 20, comparing), component("writing_numbers", 15, 20, writing),
    component("number_line", 12, 15, numberLine), component("number_facts_addition", 39, 15, addition),
    component("number_facts_subtraction", 39, 15, subtraction), component("ordering_numbers", 56, 15, ordering)
  ];
}

function grade3Components(
  comparing: number, writing: number, numberLine: number, addition: number, subtraction: number, equations: number, ordering: number
) {
  return [
    component("comparing_numbers", 40, 15, comparing), component("writing_numbers", 15, 20, writing),
    component("number_line", 10, 15, numberLine), component("number_facts_addition", 39, 12.5, addition),
    component("number_facts_subtraction", 39, 12.5, subtraction), component("equations", 16, 10, equations),
    component("ordering_numbers", 56, 15, ordering)
  ];
}

function grade4Components(
  writing: number,
  numberLine: number,
  additionSubtraction: number,
  multiplicationDivision: number,
  equations: number,
  calculationAddition: number,
  calculationSubtraction: number,
  fractions: number
) {
  return [
    component("writing_numbers", 15, 15, writing), component("number_line", 18, 15, numberLine),
    component("number_facts_addition_subtraction", 42, 10, additionSubtraction),
    component("number_facts_multiplication_division", 42, 10, multiplicationDivision),
    component("equations", 22, 15, equations), component("calculation_addition", 25, 10, calculationAddition),
    component("calculation_subtraction", 25, 10, calculationSubtraction), component("fractions", 6, 15, fractions)
  ];
}

export function screeningWindow(roundId: string): ScreeningWindow | null {
  const normalized = roundId.trim().toLowerCase();
  if (normalized === "fall" || normalized === "winter" || normalized === "spring") return normalized;
  if (normalized === "june" || normalized === "may") return "spring";
  return null;
}

export function cc3NormFor(roundId: string, grade?: string | number | null) {
  const window = screeningWindow(roundId);
  return window && grade != null ? CC3_NORMS[window][String(grade)] : undefined;
}

export function numeracyNormFor(roundId: string, grade?: string | number | null) {
  const window = screeningWindow(roundId);
  return window && grade != null ? PROVINCIAL_NUMERACY_NORMS[window][String(grade)] : undefined;
}

export function calculateCc3SupportFlag(
  norm: Cc3Norm,
  scores: Partial<Record<Cc3Component, number | null>>
) {
  const regular = scores.regular_words;
  const irregular = scores.irregular_words;
  const nonWords = scores.non_words;
  if (typeof regular !== "number" || typeof irregular !== "number" || typeof nonWords !== "number") return null;
  return regular <= norm.regular_words.requiringSupportMax && (
    irregular <= norm.irregular_words.requiringSupportMax ||
    nonWords <= norm.non_words.requiringSupportMax
  );
}

export function calculateNumeracyWeightedScore(
  norm: NumeracyNorm,
  scores: Partial<Record<NumeracyComponent, number | null>>
) {
  const values = norm.components.map((item) => scores[item.component]);
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
  const weighted = norm.components.reduce((sum, item) => {
    return sum + ((scores[item.component] as number) / item.max) * item.weight;
  }, 0);
  return Math.round(weighted);
}

export function normalizeCc3Component(value?: string | null): Cc3Component | null {
  const normalized = normalizeLabel(value);
  if (normalized.includes("regular") && !normalized.includes("irregular")) return "regular_words";
  if (normalized.includes("irregular")) return "irregular_words";
  if (normalized.includes("nonword") || normalized.includes("non_word")) return "non_words";
  return null;
}

export function normalizeNumeracyComponent(value?: string | null): NumeracyComponent | null {
  const normalized = normalizeLabel(value);
  if (normalized.includes("rote_count")) return "rote_counting";
  if (normalized.includes("counting_set")) return "counting_sets";
  if (normalized.includes("next_number")) return "next_number";
  if (normalized.includes("naming_number")) return "naming_numbers";
  if (normalized.includes("comparing_number")) return "comparing_numbers";
  if (normalized.includes("writing_number")) return "writing_numbers";
  if (normalized.includes("number_line")) return "number_line";
  if (normalized.includes("multiplication") && normalized.includes("division")) return "number_facts_multiplication_division";
  if (normalized.includes("addition") && normalized.includes("subtraction") && normalized.includes("fact")) {
    return "number_facts_addition_subtraction";
  }
  if (normalized.includes("calculation_addition")) return "calculation_addition";
  if (normalized.includes("calculation_subtraction")) return "calculation_subtraction";
  if (normalized.includes("addition")) return "number_facts_addition";
  if (normalized.includes("subtraction")) return "number_facts_subtraction";
  if (normalized.includes("equation")) return "equations";
  if (normalized.includes("ordering")) return "ordering_numbers";
  if (normalized.includes("fraction")) return "fractions";
  return null;
}

function normalizeLabel(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
