# Thoudang — 3-minute live demo script

**Presenter:** Okram Thomas Meitei · Team ASCEND · Optivox Technologies, Imphal
**Event:** AI4SEVA Hackathon, Govt of Manipur — problem SW-03 · Fri 9 Oct 2026, 9:30 AM
**Setup:** laptop running `npm run demo` (http://localhost:5173), browser full-screen at 125% zoom,
phone on the same hotspot with the camera ready.
**Signed in as DSWO before going on stage** (officer login: pick **DSWO Imphal West** → PIN 2468).
Read [RUNBOOK-STAGE.md](RUNBOOK-STAGE.md) first.

Numbers you may say out loud are in [FACTS.md](FACTS.md). Do not add any others.

---

## Before you walk on (prepared state)

The packets are the committed SPECIMEN set in `demo-packets/` (table at the end of this page).

| Thing          | State                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tab 1          | `/intake`, **Single packet** tab, phone QR visible                                                                                                                                                                                                                                         |
| Tab 2          | `/queue` with `demo-01` … `demo-06` already screened as cases (runbook: "Prime the queue") — **not** `demo-07`                                                                                                                                                                             |
| Tab 3          | `/trust` scrolled to the top                                                                                                                                                                                                                                                               |
| Phone          | QR scanned, upload page open with type **Form** selected, screen brightness max                                                                                                                                                                                                            |
| Packet on desk | `demo-07-thomas-o-resolved-by-father`: SPECIMEN form (`O. Thomas Meitei`, father `Okram Ibomcha Singh`), Aadhaar (`Okram Thomas Meitei`), passbook (`THOMAS OKRAM`) — the image **files** are primed in the cache (a new phone photo of the paper is a new image and always calls the API) |
| Queue          | _Ready_ 3 · _Needs citizen correction_ 1 (**Gaikhangam Dangmei**, notice audio primed) · _Officer attention_ 2 (**Kh. Loken Singh**; **CHABUNGBAM IBOBI SINGH**, the duplicate)                                                                                                            |

---

## 0:00 – 0:20 · Hook (20 s)

**Screen:** Tab 1 (Intake). Hold up the three SPECIMEN papers.

> "Okram Thomas Meitei. O. Thomas Meitei. Thomas Okram.
> Same person — me — on three documents.
> In Manipur, that is normal. Yumnak first or last, abbreviated or not, Singh, Meitei, or nothing.
> Today a dealing assistant compares them by eye, packet by packet, in a scheme with over a lakh
> old-age pensioners. The CAG found all 100 sampled pensioners in Manipur waited four to 44 months.
> This is Thoudang — an AI scrutiny desk for that officer."

## 0:20 – 0:55 · Live phone upload (35 s)

**Click path:**

1. Phone: pick type **Form** → **📷 Photograph Form** → take the photo (it sends on capture;
   "Sent to desk: 1" appears).
2. Phone: **Aadhaar** → **📷 Photograph Aadhaar**. Then **Passbook** → **📷 Photograph Passbook**.
3. Laptop: the three photos appear in their labelled slots (marked as from the phone) → click
   **Screen application**. The _Screening progress_ card appears; stages tick across.

**Say while it runs (this is your waiting script — keep talking):**

> "The officer photographs the packet with any phone — no scanner, no app install, just a QR on
> the local network.
> Each image is read by Claude, which returns every field with its location on the page and a
> confidence level.
> The moment the Aadhaar is read, the number is masked to the last four digits. The full number is
> never stored, never logged, never shown.
> Then plain code takes over: no AI decides anything from here."

If it is still processing at 0:50: _"A fresh photo takes several seconds per document — this is
running against the live API right now."_ (Phone photos are always new images, so they always call
the API. If the network is down, switch to fallback rung 2 in the runbook: drag the primed image
files from the laptop and say "this packet was read earlier and is replaying from the local cache".)

## 0:55 – 1:20 · Flags in seconds (25 s)

**Click path:** click the finished progress card → **Case page**.
Point at: document image on the left, **Identity card** on the right. Hover a name under
**Names as written** → that name is highlighted on the image.

**Expected on screen** (the engine's output for these exact names): status **Ready**. Identity card
pill **Same**, "Every document names the same person." All three comparisons **Same** — form vs
Aadhaar and form vs passbook say "O. = Okram, written in full elsewhere in the packet." Footer:
"Relative's full yumnak in packet: **Okram** — used to resolve abbreviations." The only flag is
info: _Optional document not provided_ (no voter ID; it is optional).

> "Three names, one verdict. The name engine knows Manipur naming: yumnak order, the optional
> Singh or Meitei, and abbreviations. 'O.' alone could be Okram or Oinam — but the father's full
> yumnak on the same form is Okram, so it resolves.
> Nothing to fix here, so it goes straight to Ready. When there is a problem, every flag says what
> is wrong, which document, the exact value read, and how confident the reading was."

## 1:20 – 1:45 · "Kh. Loken Singh" — where it refuses to guess (25 s)

**Click path:** Tab 2 (`/queue`) → **Officer attention** column → open **Kh. Loken Singh**
(`demo-04`). Point at the Identity card's **"Could be:"** list. Click the _Name needs
confirmation_ flag → the name is highlighted on the image. Click **Override…** to show the reason
dropdown, then **Cancel** (or Accept — do not spend time here).

**Expected on screen:** status **Officer attention**. Form "Kh. Loken Singh" (father's name left
blank), Aadhaar "Khuraijam Loken Singh", passbook "KHURAIJAM LOKEN SINGH". Identity pill
**Ambiguous**, "2 comparisons need an officer's confirmation." Form vs Aadhaar and form vs passbook
are **Ambiguous** — "Kh. could be Khuraijam, Khwairakpam, Khumanthem +10 more; officer to
confirm." (the **Could be:** list shows all 13); Aadhaar vs passbook is **Same**. Flags: two
_Name needs confirmation_ (warning, officer) + info _Optional document not provided_.

> "In the 2022 Assembly election, Khuraijam Loken Singh and Khwairakpam Loken Singh were both
> 'Kh. Loken Singh'. Generic matching software would call this a match.
> Thoudang says: ambiguous — here are the candidate yumnaks — an officer must confirm.
> The officer can accept or override; an override needs a reason, and it goes into an append-only
> audit log. There is no reject button anywhere in this system."

## 1:45 – 2:05 · Batch queue (20 s)

**Click path:** stay on `/queue`. Point at the three columns and the stats row
(_Total cases_, _Avg screening time_, _Issues caught_). Optionally click the **80+** or
**Disability** priority filter (no demo packet has a relief-camp address, so skip **Displaced**).
Columns: _Ready_ — Chabungbam Ibobi Singh (84), Khundrakpam Ongbi Tamphasana Devi (Ongbi married
name vs "Khundrakpam Tamphasana Devi" on the Aadhaar — Same), Nemneilhing Touthang, plus Thomas
from the live upload; _Needs citizen correction_ — Gaikhangam Dangmei; _Officer attention_ —
Kh. Loken Singh and CHABUNGBAM IBOBI SINGH (_Possible duplicate_ of the first case).

> "A batch of packets lands in three columns: Ready, Needs citizen correction, Officer attention —
> sorted by priority. Age 80-plus, widows, persons with disability and relief-camp addresses rise
> to the top. Priority never affects eligibility; it only decides who gets looked at first."

## 2:05 – 2:25 · Manipuri notice + audio (20 s)

**Click path:** **Needs citizen correction** column → open **Gaikhangam Dangmei** (`demo-05`;
flag _Date of birth differs_: form 14/01/1951, Aadhaar 24/01/1951) → **Generate notice** (or
**View notice**) → script tabs **All three** → press play on **Listen in Manipuri** for ~4 seconds →
point at the QR code on the notice.

> "For the citizen, a deficiency notice in English, Manipuri in Bengali script and in Meetei Mayek,
> with audio for those who cannot read. The wording comes from proofread templates — no AI writes
> anything a citizen receives. The QR shows only their application status.
> The Director asked beneficiaries in 2019 to keep the same name across bank, Aadhaar and voter ID.
> This notice tells each person exactly which one to fix."

## 2:25 – 2:45 · Trust (20 s)

**Click path:** Tab 3 (`/trust`). Scroll slowly through: **1. Extraction accuracy** →
**2. Name-engine fairness by community** → **3. Safeguards — with live proof**.

> "AI reads, code decides, the officer makes the final call.
> Here is measured field accuracy on our labelled test set, name-engine fairness across Meitei,
> Pangal, Naga and Kuki-Zo names, and live checks: the database is scanned for any full Aadhaar
> number, only the DSWO can approve, and the audit log cannot be edited.
> We also list our known limitations on this page — the data is synthetic and the gazetteer needs
> department review."

## 2:45 – 3:00 · Scale & pilot ask (15 s)

**Screen:** stay on Trust or switch to `/dashboard`.

> "In its NSAP audit, the CAG found 68 Manipur beneficiaries getting more than one pension, and 89
> under-80s paid the 80-plus rate. Thoudang checks duplicates and age from the documents at intake,
> runs offline except for the reading step, and is designed to DPDP standards.
> Our ask: a three-month pilot with one district Social Welfare office, on real files, with your
> officers deciding every case. Thank you."

---

## If something breaks on stage (say this, then move on)

| Problem                   | Say                                                                             | Do                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Phone upload hangs > 10 s | "Venue Wi-Fi — I'll drop the same packet from the laptop."                      | Intake → drag the 3 images from `demo-07-…` into the labelled slots → **Screen application** |
| Live AI call fails        | "When the AI cannot read, the case goes to the officer, it never blocks."       | Show the _Officer attention_ case with "extraction failed", then open a primed case          |
| Audio does not play       | "Audio is pre-generated; if it isn't available, the notice says so and prints." | Click **Print (A4)** preview instead                                                         |
| Laptop dies               | "Here is the recording of exactly this flow."                                   | Play the backup video (see runbook)                                                          |

## Timing rehearsal targets

Run it three times with a stopwatch. If you are over 3:00, cut in this order:

1. Batch priority filter click (save 5 s).
2. The Override… dialog (save 5 s).
3. Trust section 2 scroll (save 5 s).
   Never cut the hook, the Kh. Loken Singh moment, or the ask.

---

## Demo packets (`demo-packets/`, regenerate with `npm run synth -- --demo`)

Folder order = processing order. Statuses and verdicts are what the rules and name engine produce
for a perfect reading (`truth.json`); `npm run test:synth` fails if they drift.

| Folder                                | Names on the documents (form · Aadhaar · passbook)                                                                        | Expected status          | What the officer sees                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `demo-01-clean`                       | Chabungbam Ibobi Singh (father Late Chabungbam Rajen Singh) · Chabungbam Ibobi Singh · CHABUNGBAM IBOBI SINGH, + voter ID | Ready                    | All names Same; age 84, widower                                                                          |
| `demo-02-clean`                       | Nemneilhing Touthang · Nemneilhing Touthang · NEMNEILHING TOUTHANG                                                        | Ready                    | Kuki-Zo widow; info: voter ID not provided                                                               |
| `demo-03-ongbi-married-name`          | Khundrakpam Ongbi Tamphasana Devi · Khundrakpam Tamphasana Devi · KHUNDRAKPAM TAMPHASANA DEVI, + voter ID                 | Ready                    | Ongbi married name → Same                                                                                |
| `demo-04-kh-loken-ambiguous`          | Kh. Loken Singh (father blank) · Khuraijam Loken Singh · KHURAIJAM LOKEN SINGH                                            | Officer attention        | 2 × _Name needs confirmation_: "Kh." could be 13 yumnaks, nothing in the packet narrows it               |
| `demo-05-dob-mismatch`                | Gaikhangam Dangmei · Gaikhangam Dangmei · GAIKHANGAM DANGMEI                                                              | Needs citizen correction | _Date of birth differs_: form 14/01/1951 vs Aadhaar 24/01/1951 → notice                                  |
| `demo-06-duplicate-of-01`             | CHABUNGBAM IBOBI SINGH · Chabungbam Ibobi Singh · CHABUNGBAM IBOBI SINGH                                                  | Officer attention        | _Possible duplicate_ of the demo-01 case (same Aadhaar last 4, DOB, name) — only if demo-01 came first   |
| `demo-07-thomas-o-resolved-by-father` | O. Thomas Meitei (father Okram Ibomcha Singh) · Okram Thomas Meitei · THOMAS OKRAM                                        | Ready                    | All pairs Same: "O. = Okram, written in full elsewhere in the packet" (father's yumnak); the live upload |

Without the father's name, "O. Thomas Meitei" vs "Okram Thomas Meitei" is **Ambiguous** (Okram or
Oinam) — that is why the eval's context-free `name_checks` for demo-07 say AMBIGUOUS while the case
itself is Ready.
