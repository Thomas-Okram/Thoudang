# tools/synth — synthetic application packets

Generates realistic **SYNTHETIC SPECIMEN** packets (handwritten Old Age Pension form, mock Aadhaar,
mock passbook, sometimes a mock voter ID) as phone-photo-like JPEGs, with `truth.json` in the
eval-harness format (`apps/api/src/eval/score.ts`) and `layout.json` highlight boxes (for
`npm run dev:fixtures`).

```
npm run synth -- --count 40 --out eval-data/synthetic [--seed 20261009] [--mix mix.json]
npm run synth -- --demo [--out demo-packets]        # the 7 hand-picked live-demo packets
npm run test:synth                                   # (also part of npm test)
```

- `--mix` — JSON of scenario weights; unspecified scenarios keep the defaults in `src/plan.ts`
  (`DEFAULT_MIX`, ~35% clean). Counts are allocated exactly (largest remainder), then shuffled.
- Deterministic: same seed → byte-identical images and truth (fonts are bundled; fontconfig is
  pointed at `fonts/` only, with `PANGOCAIRO_BACKEND=fc`).
- Output folders written by the generator are replaced on re-run; anything else is left alone.

## How truth is made trustworthy

`expected_status` / `expected_flags` are **not hand-written**: each packet is fed, as a perfect
reading, through the API's own `normaliseExtraction` → `toExtractedCase` and core `screenCase`.
The scenario declares its _intended_ outcome (`SCENARIO_INTENT`); if the engine disagrees the packet
is re-rolled, so a planted "Ongbi married name" really is a READY case, a planted "Kh." really is
AMBIGUOUS, etc. `name_checks[].expected` is `matchNames(a, b)` without context — exactly what the
scorer recomputes — and `same_person` records the ground truth.

Extra keys (`expected_flags`, `synthetic.*`) are ignored by `TruthSchema` (zod strips them).

## Scenarios

clean · name_variant (abbreviation, order swap, dropped Singh/Devi, Ongbi married name, maiden name
on passbook, Md./Mohammad, Begum/Bibi) · ambiguous_initials · age_ineligible · income_ineligible ·
missing_document · blank_field · missing_signature · bank_holder_mismatch · dob_mismatch ·
aadhaar_last4_mismatch · aadhaar_checksum_invalid · duplicate (pairs with an earlier clean packet) ·
displaced (relief-camp address; ~8% of other packets also get one — priority only).

## Demo set (`src/demo.ts`)

`demo-01-clean`, `demo-02-clean`, `demo-03-ongbi-married-name` (READY) · `demo-04-kh-loken-ambiguous`
(OFFICER_ATTENTION, NAME_AMBIGUOUS) · `demo-05-dob-mismatch` (NEEDS_CITIZEN_CORRECTION) ·
`demo-06-duplicate-of-01` (OFFICER_ATTENTION, DUPLICATE_SUSPECTED) ·
`demo-07-thomas-o-resolved-by-father` (READY). demo-04 and demo-07 pin the exact document names
(`overrides.names`) instead of drawing them; demo-07 uses the pinned-only name variant
`abbreviation_resolved_by_relative` — "O." is ambiguous alone, the father's full yumnak on the
form resolves it, so its context-free `name_checks` say AMBIGUOUS while the case screens READY.
demo-07 is the live stage upload: prime it into the cache, never into a case (see
`docs/pitch/RUNBOOK-STAGE.md`).

Capture quality per image: `scan` / `phone` (rotation, skew, shadow, lighting, mild blur/noise,
slight crop) / `poor` (heavier). The demo set never uses `poor`.

## Caveats

- Run packets **in folder order** with a **fresh eval DB** (`rm apps/api/data/eval.db*`): duplicate
  detection compares against earlier cases, and the eval DB persists between runs.
- `dev:fixtures` only sees masked Aadhaar numbers, so the invalid-checksum packet screens READY in
  fixture mode; with real extraction it is OFFICER_ATTENTION as `truth.json` says.
- Perspective is approximated with an affine transform (rotation + skew + non-uniform scale).
- Fonts: Caveat, Kalam, Patrick Hand, PT Sans — SIL Open Font License (see `fonts/OFL-*.txt`).
