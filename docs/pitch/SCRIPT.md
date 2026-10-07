# Thoudang — 3-minute live demo script

**Presenter:** Okram Thomas Meitei · Team ASCEND · Optivox Technologies, Imphal
**Event:** AI4SEVA Hackathon, Govt of Manipur — problem SW-03 · Fri 9 Oct 2026, 9:30 AM
**Setup:** laptop running `npm run demo` (http://localhost:5173), browser full-screen at 125% zoom,
officer switcher set to **Dealing Assistant**, phone on the same hotspot with the camera ready.
Read [RUNBOOK-STAGE.md](RUNBOOK-STAGE.md) first.

Numbers you may say out loud are in [FACTS.md](FACTS.md). Do not add any others.

---

## Before you walk on (prepared state)

| Thing          | State                                                                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab 1          | `/intake`, **Single packet** tab, phone QR visible                                                                                                                                                                                                             |
| Tab 2          | `/queue` with the batch already primed (`demo:prime -- --dir ./demo-packets/batch --with-cases`)                                                                                                                                                               |
| Tab 3          | `/trust` scrolled to the top                                                                                                                                                                                                                                   |
| Phone          | QR scanned, upload page open with type **Form** selected, screen brightness max                                                                                                                                                                                |
| Packet on desk | "Thomas" packet: SPECIMEN form (`O. Thomas Meitei`, father `Okram … Singh`), Aadhaar (`Okram Thomas Meitei`), passbook (`THOMAS OKRAM`) — the image **files** are primed in the cache (a new phone photo of the paper is a new image and always calls the API) |
| Queue          | contains a **Kh. Loken Singh** case in _Officer attention_ and at least one case in _Needs citizen correction_ with notice audio primed                                                                                                                        |

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
Point at: document image on the left, **Identity card** and **Flags** on the right.
Click one flag → the field is highlighted on the image.

> "Three names, one verdict. The name engine knows Manipur naming: yumnak order, the optional
> Singh or Meitei, and abbreviations. 'O.' alone could be Okram or Oinam — but the father's full
> yumnak on the same form is Okram, so it resolves.
> Every flag says what is wrong, which document, the exact value read, and how confident the
> reading was. Click it, and you see it on the page."

## 1:20 – 1:45 · "Kh. Loken Singh" — where it refuses to guess (25 s)

**Click path:** Tab 2 (`/queue`) → **Officer attention** column → open **Kh. Loken Singh**.
Point at the Identity card's **"Could be:"** list. Click **Override…** to show the reason dropdown,
then **Cancel** (or Accept — do not spend time here).

> "In the 2022 Assembly election, Khuraijam Loken Singh and Khwairakpam Loken Singh were both
> 'Kh. Loken Singh'. Generic matching software would call this a match.
> Thoudang says: ambiguous — here are the candidate yumnaks — an officer must confirm.
> The officer can accept or override; an override needs a reason, and it goes into an append-only
> audit log. There is no reject button anywhere in this system."

## 1:45 – 2:05 · Batch queue (20 s)

**Click path:** stay on `/queue`. Point at the three columns and the stats row
(_Total cases_, _Avg screening time_, _Issues caught_). Optionally click the **Widow** or
**Displaced (address)** priority filter.

> "A batch of packets lands in three columns: Ready, Needs citizen correction, Officer attention —
> sorted by priority. Age 80-plus, widows, persons with disability and relief-camp addresses rise
> to the top. Priority never affects eligibility; it only decides who gets looked at first."

## 2:05 – 2:25 · Manipuri notice + audio (20 s)

**Click path:** **Needs citizen correction** column → open a case → **Generate notice** (or
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

| Problem                   | Say                                                                             | Do                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Phone upload hangs > 10 s | "Venue Wi-Fi — I'll drop the same packet from the laptop."                      | Intake → drag the 3 primed images into the labelled slots → **Screen application**  |
| Live AI call fails        | "When the AI cannot read, the case goes to the officer, it never blocks."       | Show the _Officer attention_ case with "extraction failed", then open a primed case |
| Audio does not play       | "Audio is pre-generated; if it isn't available, the notice says so and prints." | Click **Print (A4)** preview instead                                                |
| Laptop dies               | "Here is the recording of exactly this flow."                                   | Play the backup video (see runbook)                                                 |

## Timing rehearsal targets

Run it three times with a stopwatch. If you are over 3:00, cut in this order:

1. Batch priority filter click (save 5 s).
2. The Override… dialog (save 5 s).
3. Trust section 2 scroll (save 5 s).
   Never cut the hook, the Kh. Loken Singh moment, or the ask.
