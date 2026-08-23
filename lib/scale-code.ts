export type ScaleCodeEditorResult = {
  value: string | null;
  validationErrors: string[] | null;
};

export function validScaleCodeValue(value: unknown, codes: string[]) {
  const typedValue = String(value ?? "").trim();
  if (!typedValue) return null;
  return codes.find((code) => code.toLowerCase() === typedValue.toLowerCase()) ?? null;
}

export function resolveScaleCodeEditorValue(
  draftValue: unknown,
  liveInputValue: unknown,
  codes: string[]
): ScaleCodeEditorResult {
  const normalizedCodes = codes.map((code) => code.trim()).filter(Boolean);
  const currentValue = typeof liveInputValue === "string" ? liveInputValue : draftValue;
  const typedValue = String(currentValue ?? "").trim();
  const value = validScaleCodeValue(typedValue, normalizedCodes);

  return {
    value,
    validationErrors: !typedValue || value ? null : [`Choose one of: ${normalizedCodes.join(", ")}.`]
  };
}
