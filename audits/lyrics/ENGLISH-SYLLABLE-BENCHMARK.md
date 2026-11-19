# English syllable estimator: small diagnostic benchmark

This is a hand-curated diagnostic set, not a representative corpus and not evidence of singability. Counts reflect common pronunciations; words with common variation are marked. It is intended to expose spelling-heuristic failure modes before any UI use.

| Word | Common count | Notes |
|---|---:|---|
| stay | 1 | |
| little | 2 | |
| wanted | 2 | |
| tomorrow | 3 | |
| beautiful | 3 | |
| every | 2 | common compressed pronunciations vary |
| family | 3 | often compressed in speech/song |
| different | 3 | |
| chocolate | 2 | often reduced; dictionary pronunciations vary |
| fire | 1 | often 1 or 2, dialect-dependent |
| hour | 1 | often 1 or 2, dialect-dependent |
| poem | 2 | |
| people | 2 | |
| queue | 1 | spelling trap |
| rhythm | 2 | spelling trap |
| business | 2 | spelling trap |
| island | 2 | silent-letter trap |
| walked | 1 | |
| wanted | 2 | suffix rule |
| watches | 2 | suffix rule |

The table is intentionally short and partly includes variant pronunciations. It must not be used as a strict pass/fail test for content. Before considering integration, build a larger independently checked sample with pronunciation variants, names, contractions, compounds, and unfamiliar words; report exact-match and absolute-error rates separately, and define a conservative unknown/ambiguous behavior.

CMUdict was inspected from upstream HEAD `74790861f652b15e4ac49015a90074ad62a27690`: dictionary file ~3.5 MiB; license is BSD-like and requires retaining notices/disclaimer. Do not vendor it until version pinning, attribution, coverage and unknown-word policy are explicitly settled.
