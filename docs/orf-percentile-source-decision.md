# ORF percentile norm-source decision

## Current local implementation

APP-093 now uses the project owner's supplied `2017_ORF_NORMS.pdf`, which contains the Hasbrouck & Tindal (2017) compiled oral-reading-fluency norms in correct words per minute (CWPM).

The Assessment Builder exposes three versioned calculations:

- `orf_percentile_hasbrouck_tindal_2017_fall`
- `orf_percentile_hasbrouck_tindal_2017_winter`
- `orf_percentile_hasbrouck_tindal_2017_spring`

The source provides anchor scores for P10, P25, P50, P75, and P90. The app returns the highest published percentile anchor whose CWPM threshold is less than or equal to the student's ORF median. A median below the P10 threshold returns P1, and a median at or above the P90 threshold returns P90. This makes a percentile value available for every valid ORF median when the source includes that grade and window; there is no longer an `ORF_MED >= 50` cutoff.

## Supported grades and windows

- Grades 1-6 use the source's published norms.
- Grade 1 Winter and Spring are supported.
- Grade 1 Fall remains blank because the source explicitly provides no norm for that combination.
- Grades 2-6 support Fall, Winter, and Spring.
- Grades 7-12 remain blank rather than extrapolating Grade 6 norms.

## Calculation boundaries

- All three passage CWPM values must be present before percentile is calculated.
- Passage CWPM is `max(WPM - EPM, 0)`.
- `ORF_MED` is the median of the three passage CWPM values.
- The displayed result is a published percentile anchor, not an interpolated exact percentile.
- Existing generic `orf_percentile` fields and the earlier `orf_percentile_fastbridge2019_*_test` fields are normalized to the matching 2017 seasonal key when saved templates load.
- Percentile outputs remain calculated and read-only.

## Deployment status

This change is local-only for review and testing. It must not be promoted to the Test environment until the project owner explicitly approves deployment.

Before production use, the school should still confirm that its ORF instrument, administration protocol, three-passage median method, and assessment-window definitions are compatible with these compiled norms.
