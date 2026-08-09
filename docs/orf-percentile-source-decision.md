# ORF percentile norm-source decision

## Why the current calculation cannot be released

The existing generic `orf_percentile` calculation is a placeholder. It does not use grade or assessment window and its fixed WCPM bands are not an authoritative percentile table.

No single reviewed source supports the app's current generic protocol across grades 3–12:

- Hasbrouck and Tindal's 2017 compiled ORF norms provide selected benchmark percentiles for grades 1–6 and specific fall, winter, and spring windows. They do not provide exact 1–99 ranks for every grade/window used by this app.
- FastBridge publishes instrument-specific CBMreading percentile tables for supported grades. Those norms are appropriate only when the school uses that licensed instrument, passages, administration rules, and scoring protocol.
- Neither source authorizes silently extending percentile values into grades 9–12.

Returning a precise percentile without a compatible source would create false assessment data. Unsupported combinations must show **Unavailable for this grade/window**, not a fabricated value.

## School decision required

The school must record:

1. The assessment instrument and edition.
2. The authorized norm source and version.
3. Supported grades.
4. Fall, winter, and spring window definitions.
5. Passage and scoring protocol, including whether a median of three passages is compatible with the source.
6. Whether the UI should display source-provided benchmark bands or an explicitly approved interpolation.
7. Licensing or redistribution limits for embedding the table in software.

## Implementation contract after approval

- Add a versioned norm registry containing source, version, URL, protocol, supported grades/windows, and thresholds.
- Use explicit calculation keys such as `orf_percentile_ht2017_fall`; never reinterpret the legacy generic key.
- Pass grade, window, raw metric, source key, and source version into the calculation.
- Expose only compatible keys in Assessment Builder.
- Keep all percentile outputs calculated and read-only.
- Store the source key and version with every persisted result so later norm updates do not rewrite history silently.
- Unit-test each supported threshold boundary and every unsupported grade/window combination.

Reviewed sources:

- Hasbrouck and Tindal technical report: <https://files.eric.ed.gov/fulltext/ED605146.pdf>
- FastBridge CBMreading percentile table: <https://support-content.fastbridge.org/KB_Articles/CBMreading_percent_ranking_1-99_2019.pdf>
