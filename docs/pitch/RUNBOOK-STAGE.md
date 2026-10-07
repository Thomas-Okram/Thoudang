# Stage runbook — Fri 9 Oct 2026, 9:30 AM

Technical detail for each command is in [../demo-runbook.md](../demo-runbook.md) and
[../phone-upload.md](../phone-upload.md). This page is the checklist you follow on the day.

---

## Night before (Thu 8 Oct) — needs internet and the API keys

### Software

- [ ] `git pull` the branch you will demo; `npm install`; `npm test` is green.
- [ ] `apps/api/.env` has `ANTHROPIC_API_KEY` (and `GEMINI_API_KEY` for audio).
- [ ] `npm run smoke -- eval-data/example-packet-01/aadhaar.jpg` returns masked JSON. Note the latency.
- [ ] `npm run eval -- --dir ./eval-data` — write the accuracy and cost-per-packet figures on a card
      in your pocket (Q&A A1 and C4). These are the only performance numbers you may quote.
- [ ] Prime every stage packet (cache only, no cases): `npm run demo:prime -- --dir ./demo-packets`
- [ ] **Prime the queue** — cases for `demo-01` … `demo-06` only, one folder at a time, in order
      (demo-01 must precede its duplicate demo-06; all cache hits, no API calls):
      `for d in demo-packets/demo-0[1-6]-*; do npm run demo:prime -- --dir "./$d" --with-cases; done`
      Never create a case for `demo-07-thomas-o-resolved-by-father` — it is the live upload, and an
      existing case would make it a _Possible duplicate_.
      Check the queue: _Ready_ 3, _Needs citizen correction_ 1 (**Gaikhangam Dangmei**),
      _Officer attention_ 2 (**Kh. Loken Singh**, and **CHABUNGBAM IBOBI SINGH** as a possible
      duplicate). Expected verdicts per packet: table at the end of [SCRIPT.md](SCRIPT.md).
- [ ] `npm run notices:prime` — open one notice and press play; audio must work offline afterwards.
- [ ] `npm run seed:dashboard` — `/dashboard` shows charts.
- [ ] `npm run fairness -- --holdout ./holdout-pairs.csv` if you have staff-written pairs.
- [ ] Open `/trust`: section 1 shows numbers (not "No evaluation has been run yet"); section 3 checks
      are green; press the leak scan.

### Rehearse

- [ ] Run [SCRIPT.md](SCRIPT.md) three times with a stopwatch, under 3:00 each.
- [ ] Rehearse once with Wi-Fi **off** (cache only) so you know what a primed replay looks like.
- [ ] Press **Ctrl+Shift+R** after each run (demo reset: removes live cases, keeps cache, audio,
      templates and history). The reset also removes the primed queue cases — re-run the
      "Prime the queue" loop above (instant, cache only) and reload `/queue`.

### Backup video

- [x] A silent, automatic backup already exists: `npm run demo:record` →
      `demo-recording/thoudang-demo.webm` (1440×900, ~1:50, fixtures mode, "Fixture data (no AI)"
      labels visible). Regenerate it after any UI change; it plays in Chrome / VLC.
- [ ] Screen-record one clean run of the full script (QuickTime → New Screen Recording), 1080p, with
      your voice. Save to the desktop **and** a USB stick **and** the phone. Name it
      `thoudang-demo-backup.mov`. Watch it once end to end.
- [ ] Export the deck to PDF on the USB stick too.

### Physical kit

- [ ] Printed SPECIMEN packet for the hook (form, Aadhaar, passbook), printed from
      `demo-packets/demo-07-thomas-o-resolved-by-father/` (`form.jpg`, `aadhaar.jpg`,
      `passbook.jpg`). Note: a phone photo of the paper is a new image and always calls the API —
      only the original image **files** replay from the cache. Copy those three files to a desktop folder
      `stage-packet/` ready to drag.
- [ ] Laptop charger, phone charger, USB-C to HDMI adapter (+ spare), clicker if allowed.
- [ ] Second phone (or a friend's) for the hotspot plan.

---

## 30 minutes before

- [ ] Laptop plugged in. Close every app except the browser and one terminal.
- [ ] **Do Not Disturb / Focus on** (Control Centre → Focus). Quit Slack, Mail, Messages, WhatsApp
      Desktop. Turn off notification banners for the browser.
- [ ] Display: brightness 100%, Night Shift off, True Tone off, auto-lock "Never"
      (System Settings → Lock Screen → turn display off: Never). Disable screen saver.
- [ ] Mirror the display to the projector (not extended) so you see what the judges see.
- [ ] Browser: one window, full screen, zoom **125%** (`Cmd +`), bookmarks bar hidden, no other tabs
      besides the three demo tabs (Intake, Queue, Trust). Clear any autofill pop-ups.
- [ ] Start the app: `npm run demo` → wait for "listening" → open http://localhost:5173.
      Health badge in the sidebar shows API OK and **demo mode**.
- [ ] Signed in as **DSWO Imphal West** (officer login: pick officer → PIN 2468).
- [ ] Network test: phone browser opens `http://<laptop-ip>:5173/api/health` and shows `"status":"ok"`.
- [ ] Scan the Intake QR on the phone; leave the upload page open on **Form**. Phone: Do Not Disturb,
      brightness max, auto-lock off, battery > 70%.
- [ ] Do one throwaway live upload, then **Ctrl+Shift+R** to reset and re-run the "Prime the queue"
      loop (the reset removes the primed queue cases too).
- [ ] Backup video open in QuickTime, paused on frame 1, in a separate desktop space (swipe-ready).
- [ ] Water. Card with eval numbers in pocket.

---

## On-stage fallback ladder

Decide in **5 seconds**, say one sentence, move down one rung. Never debug on stage.

| Rung                                          | When                            | What you do                                                                                                                                              | What you say                                                                                                                   |
| --------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1. Live API                                   | Health badge shows AI reachable | Run the script as written — phone photos call Claude live                                                                                                | "This is reading live right now."                                                                                              |
| 2. `cache_first` (default for `npm run demo`) | API slow or unreachable         | Drag the primed image files from `stage-packet/` into the Intake slots → **Screen application** — identical files replay from the local cache instantly. | "This packet was read earlier and is replaying from the local cache; everything after the reading step runs without internet." |
| 3. Already-screened cases                     | Upload itself fails             | Skip upload; go straight to `/queue` and open the primed cases                                                                                           | "Let me show you a packet that was screened this morning."                                                                     |
| 4. Recorded video                             | Laptop, projector or app fails  | Switch to `thoudang-demo-backup.mov` and narrate over it                                                                                                 | "Here is a recording of exactly this flow; I'll talk you through it."                                                          |

If the Thomas packet was already screened from the phone, dropping the same packet again will
(correctly) raise a suspected-duplicate flag. Either say so — "it caught the duplicate" — or skip to
rung 3.

If a live call fails mid-demo, the case lands in _Officer attention_ with "extraction failed —
manual review". That is a feature: point at it and say _"when the AI can't read, it goes to a person,
it never blocks"_ — then move on.

Never use `npm run dev:fixtures` on stage unless you say out loud "this is fixture data, no AI" —
the screen labels it, and judges will see it.

---

## If Wi-Fi or the phone upload fails

1. **Symptom:** phone spinner or "can't connect" on the QR link → venue Wi-Fi has client isolation.
2. **Fastest fix on stage:** don't fix it. Drag the same primed images from the laptop into the
   Intake slots (rung 2). Say: "Venue Wi-Fi blocks device-to-device traffic; the laptop can do the
   same upload."
3. **Fix before your slot (if you have 2 minutes):** phone hotspot
   - Phone A: Personal Hotspot **on** (mobile data on).
   - Laptop: join phone A's hotspot.
   - Restart `npm run demo` (the laptop IP changes) and **reload** Intake so the QR updates.
   - Phone B joins the same hotspot and scans the new QR. Test `/api/health` first.
   - Typical IPs: iPhone `172.20.10.x`, Android `192.168.43.x` or `10.x.x.x`.
   - If the QR shows `localhost`, the laptop is not on any network.
4. macOS firewall prompt "Allow node to accept incoming connections?" → **Allow**.
5. If the hotspot has no data, cached packets still work (rung 2); only new photos need the API.

---

## After the demo

- [ ] **Ctrl+Shift+R** to reset before the next judge panel, then re-run the "Prime the queue" loop.
- [ ] Keep the app running for the Q&A — open `/trust` or `/dashboard` to answer questions on screen.
