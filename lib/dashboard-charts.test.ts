import { describe, expect, it } from "vitest";
import {
  addDashboardChart,
  compactDashboardChartLabel,
  compactDashboardLegendLabel,
  dashboardAxisLabelCharacterLimit,
  dashboardLegendLabelCharacterLimit,
  dashboardYearGroups,
  formatDashboardTooltipLabel,
  labelDashboardYears,
  removeDashboardChart
} from "./dashboard-charts";

const points = [
  { axisKey: "2025-fall", year: "2025-2026", window: "Fall", section: "Letter Identification" },
  { axisKey: "2025-winter", year: "2025-2026", window: "Winter", section: "Letter Identification" },
  { axisKey: "2026-fall", year: "2026-2027", window: "Fall", section: "Phonological Awareness" },
  { axisKey: "2026-winter", year: "2026-2027", window: "Winter", section: "Phonological Awareness" },
  { axisKey: "2026-spring", year: "2026-2027", window: "Spring", section: "Phonological Awareness" }
];

describe("dashboard chart presentation", () => {
  it("compacts crowded labels to at least five characters and keeps short labels intact", () => {
    expect(compactDashboardChartLabel("  Letter   ID  ")).toBe("Letter ID");
    expect(compactDashboardChartLabel("Phonological Awareness", 16)).toBe("Phonological Awa...");
    expect(compactDashboardChartLabel("Winter", 5)).toBe("Winte...");
    expect(compactDashboardChartLabel("Fall", 2)).toBe("Fall");
  });

  it("uses chart density to shorten axis and legend labels only when space is tight", () => {
    expect(dashboardAxisLabelCharacterLimit(1000, 60)).toBe(5);
    expect(dashboardAxisLabelCharacterLimit(1000, 8)).toBe(16);
    expect(dashboardLegendLabelCharacterLimit(1000, 1)).toBe(32);
    expect(dashboardLegendLabelCharacterLimit(1000, 8)).toBe(12);
  });

  it("keeps the Field portion distinguishable when a legend label is shortened", () => {
    expect(compactDashboardLegendLabel("Oral Reading Fluency / WPM", 16)).toBe("Oral Rea... / WPM");
    expect(compactDashboardLegendLabel("Oral Reading Fluency / Comprehension", 12)).toBe("Oral... / Compr...");
  });

  it("identifies each contiguous school-year boundary and midpoint", () => {
    expect(dashboardYearGroups(points)).toEqual([
      {
        year: "2025-2026",
        firstAxisKey: "2025-fall",
        lastAxisKey: "2025-winter",
        labelAxisKey: "2025-winter"
      },
      {
        year: "2026-2027",
        firstAxisKey: "2026-fall",
        lastAxisKey: "2026-spring",
        labelAxisKey: "2026-winter"
      }
    ]);
  });

  it("labels every year exactly once even when it has multiple chart points", () => {
    const labelled = labelDashboardYears(points);
    expect(labelled.filter((point) => point.yearLabel === "2025-2026")).toHaveLength(1);
    expect(labelled.filter((point) => point.yearLabel === "2026-2027")).toHaveLength(1);
  });

  it("formats clean tooltip headers without exposing internal axis keys", () => {
    expect(formatDashboardTooltipLabel(points[2])).toBe("2026-2027 · Fall · Phonological Awareness");
    expect(formatDashboardTooltipLabel({ ...points[2], section: "" })).toBe("2026-2027 · Fall");
    expect(formatDashboardTooltipLabel(undefined)).toBe("");
  });
});

describe("dashboard chart controls", () => {
  it("adds a distinct chart without changing existing chart identities", () => {
    const current = ["chart-1", "chart-2"];
    expect(addDashboardChart(current, "chart-3")).toEqual(["chart-1", "chart-2", "chart-3"]);
    expect(addDashboardChart(current, "chart-2")).toBe(current);
  });

  it("removes only the requested chart", () => {
    expect(removeDashboardChart(["chart-1", "chart-2", "chart-3"], "chart-2")).toEqual(["chart-1", "chart-3"]);
  });

  it("keeps the final chart open", () => {
    const onlyChart = ["chart-1"];
    expect(removeDashboardChart(onlyChart, "chart-1")).toBe(onlyChart);
  });
});
