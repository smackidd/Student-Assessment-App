# ORF percentile norm-source decision

## Current testing implementation

APP-093 was completed for testing on 2026-08-10 with the project owner's authorization to use the closest aligned public norms until the school confirms its policy.

The app exposes three explicit, test-only calculation keys:

- `orf_percentile_fastbridge2019_fall_test`
- `orf_percentile_fastbridge2019_winter_test`
- `orf_percentile_fastbridge2019_spring_test`

The provisional lookup uses the public FastBridge CBMreading 2019 score-to-percentile tables for grades 3-8. It retains the requested school rule that percentile stays blank when raw `ORF_MED >= 50`. Because that rule makes higher thresholds unreachable, the app embeds only the exact published thresholds below 50 CWPM and returns the highest percentile whose threshold is less than or equal to the median.

Additional boundaries:

- All three passage CWPM values must be present before percentile is calculated.
- `ORF_MED` remains the median of the three `max(WPM - EPM, 0)` passage values.
- Grades 9-12 remain unavailable rather than extrapolating grade-8 norms.
- Existing saved `orf_percentile` fields are migrated in memory to the three seasonal testing keys.
- Results are provisional testing estimates, not a finalized school-approved norm interpretation.

Testing source:

- FastBridge CBMreading score-to-percentile tables: <https://support-content.fastbridge.org/KB_Articles/CBMreading_percent_ranking_1-99_2019.pdf>
- FastBridge screening protocol: <https://fastbridge.illuminateed.com/hc/en-us/articles/1260802463470-Screening-Basics>

## Why this is not yet a production policy

No single reviewed source supports the app's generic protocol across grades 3-12:

- Hasbrouck and Tindal's 2017 compiled ORF norms provide selected benchmark percentiles for grades 1-6 and specific fall, winter, and spring windows. They do not provide exact 1-99 ranks for every grade/window used by this app.
- FastBridge publishes instrument-specific CBMreading percentile tables through grade 8. Those norms are appropriate as validated results only when the school uses that instrument, passages, administration rules, and scoring protocol.
- Neither source authorizes silently extending percentile values into grades 9-12.

## School confirmation still required

Before the testing keys are promoted or renamed for production, the school must record:

1. The assessment instrument and edition.
2. The authorized norm source and version.
3. Supported grades.
4. Fall, winter, and spring window definitions.
5. Passage and scoring protocol, including whether a median of three passages is compatible with the source.
6. Whether the UI should display source-provided benchmark bands or an explicitly approved interpolation.
7. Licensing or redistribution limits for embedding the table in software.

## Production replacement contract

- Replace the `_test` keys with school-approved, versioned source keys; never reinterpret the legacy generic key silently.
- Store the source key and version with every persisted result so later norm updates do not rewrite history.
- Expose only compatible keys in Assessment Builder.
- Keep percentile outputs calculated and read-only.
- Unit-test every supported threshold boundary and unsupported grade/window combination.

Other reviewed source:

- Hasbrouck and Tindal technical report: <https://files.eric.ed.gov/fulltext/ED605146.pdf>
