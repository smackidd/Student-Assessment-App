import { describe, expect, it } from "vitest";
import { resolveScaleCodeEditorValue, validScaleCodeValue } from "./scale-code";

describe("scale code entry", () => {
  const codes = ["Beginning", "Developing", "Proficient"];

  it("accepts a configured text code without changing its canonical spelling", () => {
    expect(validScaleCodeValue("developing", codes)).toBe("Developing");
  });

  it("uses the live editor input when React state has not rendered before Tab commits", () => {
    expect(resolveScaleCodeEditorValue("", "Developing", codes)).toEqual({
      value: "Developing",
      validationErrors: null
    });
  });

  it("rejects values outside the configured scale and allows clearing a value", () => {
    expect(resolveScaleCodeEditorValue("Beginning", "Unknown", codes)).toEqual({
      value: null,
      validationErrors: ["Choose one of: Beginning, Developing, Proficient."]
    });
    expect(resolveScaleCodeEditorValue("Beginning", "", codes)).toEqual({
      value: null,
      validationErrors: null
    });
  });
});
