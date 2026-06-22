import { calculateOrfRound } from "@/lib/orf-calculations";

export type AssessmentValue = string | number | null;
export type AssessmentValueMap = Record<string, AssessmentValue>;

export type OrfResultRow = {
  id: string;
  homeroom: string;
  student: string;
  assessmentValues?: AssessmentValueMap;
  septP1Wpm: number | null;
  septP1Epm: number | null;
  septP2Wpm: number | null;
  septP2Epm: number | null;
  septP3Wpm: number | null;
  septP3Epm: number | null;
  septP1Cwpm: number | null;
  septP2Cwpm: number | null;
  septP3Cwpm: number | null;
  septMedian: number | null;
  septPercentile: number | null;
};

const baseRows: Array<Omit<OrfResultRow, "septP1Cwpm" | "septP2Cwpm" | "septP3Cwpm" | "septMedian" | "septPercentile">> = [
  {
    id: "student-a",
    homeroom: "3A",
    student: "A",
    septP1Wpm: 38,
    septP1Epm: 14,
    septP2Wpm: 55,
    septP2Epm: 23,
    septP3Wpm: 44,
    septP3Epm: 24
  },
  {
    id: "student-b",
    homeroom: "3A",
    student: "B",
    septP1Wpm: 45,
    septP1Epm: 5,
    septP2Wpm: null,
    septP2Epm: null,
    septP3Wpm: null,
    septP3Epm: null
  },
  {
    id: "student-c",
    homeroom: "3A",
    student: "C",
    septP1Wpm: 66,
    septP1Epm: 3,
    septP2Wpm: null,
    septP2Epm: null,
    septP3Wpm: null,
    septP3Epm: null
  },
  {
    id: "student-d",
    homeroom: "3B",
    student: "D",
    septP1Wpm: 12,
    septP1Epm: 1,
    septP2Wpm: null,
    septP2Epm: null,
    septP3Wpm: null,
    septP3Epm: null
  }
];

export function hydrateOrfRow(row: Omit<OrfResultRow, "septP1Cwpm" | "septP2Cwpm" | "septP3Cwpm" | "septMedian" | "septPercentile">): OrfResultRow {
  const round = calculateOrfRound([
    { wpm: row.septP1Wpm, epm: row.septP1Epm },
    { wpm: row.septP2Wpm, epm: row.septP2Epm },
    { wpm: row.septP3Wpm, epm: row.septP3Epm }
  ]);

  return {
    ...row,
    septP1Cwpm: round.cwpmValues[0],
    septP2Cwpm: round.cwpmValues[1],
    septP3Cwpm: round.cwpmValues[2],
    septMedian: round.median,
    septPercentile: round.percentile
  };
}

export const initialOrfRows = baseRows.map(hydrateOrfRow);
