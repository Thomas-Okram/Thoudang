# Thoudang — deck content (7 slides)

Design: navy `#0A1B33` background on title/ask slides, white elsewhere, teal accent, one idea per
slide, large type. Every number on a slide must appear in [FACTS.md](FACTS.md) with its source in a
footnote line.

---

## 1. Problem — "Same person. Three documents."

- Okram Thomas Meitei · O. Thomas Meitei · Thomas Okram — one pensioner, three spellings.
- CAG (Report 2 of 2022): all 100 sampled Manipur pensioners got benefits 4 to 44 months late.
- CAG NSAP audit (Report 10 of 2023): 68 got more than one pension; 89 under-80s paid the 80+ rate.

**Visual:** the three SPECIMEN documents side by side, the three name fields circled in teal.
Footer: CAG report numbers.

## 2. What Thoudang does

- Officer photographs the packet with a phone; AI reads every field with evidence and confidence.
- Deterministic rules and a Manipur-aware name engine sort cases into Ready / Needs citizen
  correction / Officer attention.
- Drafts a deficiency notice in English, Bengali-script Manipuri and Meetei Mayek, with audio.

**Visual:** one-line flow diagram: Phone → AI reads → Code checks → Officer decides → Citizen notice.
Tagline under it: _AI reads, code decides, officer makes the final call._

## 3. Live demo

- (Placeholder — switch to the browser.)

**Visual:** full-bleed screenshot of the Queue page with the three columns, plus the word "LIVE".
Keep this slide up only while switching windows.

## 4. Why it's trustworthy

- No reject status; only the DSWO can approve; every override needs a reason and is logged in an
  append-only audit trail.
- Aadhaar masked to the last 4 digits on arrival; images redacted on the server; a live scan proves
  no full number is stored.
- Trust Report publishes accuracy, per-community fairness and known limitations.

**Visual:** screenshot of Trust Report §3 "Safeguards — with live proof" with the green checks.

## 5. Why Manipur-specific matters

- Yumnak order, optional Singh/Meitei/Devi/Chanu, and abbreviations like "Kh." or "Th." break
  generic name matching.
- 2022 Assembly election: Khuraijam Loken Singh and Khwairakpam Loken Singh both became
  "Kh. Loken Singh" — Thoudang flags this as ambiguous and names the candidates.
- Built for 385 days of internet suspension since May 2023: local database, cached reads, manual
  path never blocked.

**Visual:** the Identity card with "Kh. Loken Singh" and its "Could be:" list.

## 6. Scale & business model

- Same engine extends to other Social Welfare schemes, scholarships and transport documents (TR-03)
  — only the scheme rules file and document schemas change.
- Government licence per department per year, deployed in-state or in an India cloud region; AI cost
  per application is passed through at cost.
- Precedent: Himachal's HIMSeva (May 2026) checks name/DOB mismatches before submission — nobody
  does it for North-East naming.

**Visual:** a simple map of Manipur's districts with "Pilot district → all districts → other NE states" arrows.

## 7. Pilot ask

- Three-month pilot in one district Social Welfare office, on real Old Age Pension files.
- Officers decide every case; we measure time per file, deficiencies caught, and officer overrides.
- Need: access to anonymised past files to tune the name gazetteer, plus one native-speaker reviewer
  for notice templates.

**Visual:** navy slide, three lines, contact: Okram Thomas Meitei · Team ASCEND · Optivox
Technologies, Imphal.
