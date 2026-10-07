# Demo runbook — Fri 9 Oct 2026, 9:30 AM

## Night before (needs internet + `ANTHROPIC_API_KEY` in `apps/api/.env`)

```bash
npm install
npm test                                       # everything green
npm run smoke -- eval-data/example-packet-01/aadhaar.jpg   # one real call: check the JSON + latency
npm run eval -- --dir ./eval-data              # accuracy/latency/cost (classify + extract)
npm run eval -- --dir ./eval-data --labelled   # same, labelled-slot speed path — compare latency
npm run demo:prime -- --dir ./demo-packets     # real results → main DB cache (no cases created)
npm run seed:dashboard                         # synthetic history so the dashboard is alive
npm run fairness -- --holdout ./holdout-pairs.csv   # staff-written name pairs → Trust Report
# optional: pre-fill the queue for the batch story
npm run demo:prime -- --dir ./demo-packets/batch --with-cases
```

`demo:prime` writes the cache for both "classify" and "extract", so a primed packet is instant whether
it is dropped into labelled slots or into "Other / unsorted". It creates no cases by default —
re-uploading a primed packet on stage would otherwise be flagged as a duplicate.

Notice audio (needs `GEMINI_API_KEY`): screen the demo packets once (Intake or
`demo:prime --with-cases`), then:

```bash
npm run notices:prime                          # Manipuri audio for every case needing a notice
```

## On stage

```bash
npm run demo        # builds the web app; API serves it on http://localhost:5173, DEMO_MODE=cache_first
```

- Phone: scan the QR on Intake (LAN/hotspot — see `docs/phone-upload.md`). New photos call Claude live.
- Pick the officer (top right): **Dealing Assistant** to review/override/edit, **DSWO Imphal West** to approve.
- Nothing is watched in demo mode — editing code will not restart the server mid-demo.
- Between run-throughs press **Ctrl+Shift+R** (demo mode only): removes live cases, keeps the
  primed cache, notice audio, templates and synthetic history.

## If the network dies

- Primed packets still replay instantly (cache). Unprimed images go to _Officer attention_ with
  "extraction failed — manual review" — the UI never hangs.
- Last resort, no key at all: `npm run dev:fixtures` seeds the SPECIMEN packets from truth.json.
  Everything shows **"Fixture data (no AI)"** — say so out loud; never present it as AI output.

## Reset between rehearsals

Stop the server, then:

```bash
rm apps/api/data/thoudang.db*  # cases, audit and CACHE — re-run demo:prime afterwards
npm run seed
```
