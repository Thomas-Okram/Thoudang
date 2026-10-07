# Judge Q&A — 45 questions, crisp answers

Answer in two or three sentences, then stop. If a number is not in [FACTS.md](FACTS.md) or on the
Trust Report screen, say you will send it later. "Today" = what the prototype does now; "in a
pilot" = what we would build next. Never blur the two.

---

## Panel A — Technical Trust (17)

### Accuracy & hallucination

**A1. How accurate is the extraction?**
Field-level accuracy on our labelled SPECIMEN test set is on the Trust Report, section 1 — I'll read
it from the screen. It is measured on synthetic packets only, and the page says so; real accuracy
has to be measured in a pilot on real files.

**A2. What happens when the AI hallucinates a value?**
Every field comes back with its location on the image and a confidence level, so the officer can
see exactly where a value was read from. Low-confidence or unreadable fields go to the officer as
"verify", never to the citizen as a deficiency, and the officer can correct any field — the rules
re-run with no AI call.

**A3. Does the AI decide eligibility?**
No. The AI only reads documents. Age, income, required documents and name matching are plain,
deterministic code with thresholds in a config file, and the officer makes the final decision.

**A4. Can it wrongly reject someone?**
There is no reject status in the system — the only outcomes are Ready, Needs citizen correction,
Officer attention, and Approved by officer. Even "age below minimum" is an officer flag, not a
rejection. The Trust Report proves this live by checking the database statuses.

**A5. How do you know the name engine is fair to every community?**
The Trust Report shows accuracy, false matches and false non-matches separately for Meitei, Pangal,
Naga and Kuki-Zo names. Our current 58-pair set was written alongside the engine, so it is
in-sample; the page lets the department import its own held-out pairs, and we will quote that
number only.

**A6. What if a name is genuinely ambiguous, like "Kh. Loken Singh"?**
The engine refuses to guess: it marks the match ambiguous, lists the candidate yumnaks
(Khuraijam, Khwairakpam, …), and sends it to an officer. If a relative's full yumnak in the same
packet narrows it to one, it resolves automatically and says why.

**A7. What about women whose yumnak changes at marriage?**
For a female applicant, same given name with a different yumnak is treated as ambiguous, not as a
mismatch, so it goes to the officer rather than generating a citizen notice. Forms like
"Laishram Ningol Okram Ongbi" are parsed into maiden and married family names.

**A8. How do you handle handwriting and poor photos?**
Images are auto-rotated and resized on the server, and each field's confidence is reported. A field
read with low confidence is routed to the officer; an image that cannot be identified at all never
produces a citizen "missing document" flag — it becomes an officer task.

### Privacy, Aadhaar & security

**A9. How do you protect Aadhaar numbers?**
Immediately after reading, the number is masked to `XXXX XXXX 1234`; we keep the last four digits
and whether the checksum is valid, and discard the rest — before anything reaches the database,
logs or the screen. Images served to the browser are redacted on the server. The Trust Report runs a
live scan of the database for any full 12-digit number.

**A10. Is this compliant with the DPDP Act?**
The DPDP Rules were notified on 13 Nov 2025, and the substantive duties apply from mid-May 2027, so
we say it is designed to DPDP standards: data minimisation, purpose limitation, masking and an
audit trail. A formal compliance review would be part of the pilot.

**A11. Is citizen data sent to a foreign AI company?**
In the prototype, only document images go to the Anthropic API, and only synthetic SPECIMEN data is
used. For production we would run the same model through an India cloud region (AWS Bedrock,
Mumbai/Hyderabad) or an on-premise model, so data stays in India; the extraction layer is one
module, so the model is swappable.

**A12. Does the AI provider train on this data?**
Commercial API traffic is not used for model training under the provider's standard terms, and in
production we would contract for that explicitly. Either way, nothing the AI returns is stored
before Aadhaar masking.

**A13. Who can approve a case? How do you stop misuse by staff?**
Permissions are checked on the server: a dealing assistant can review and flag, only the DSWO can
approve. Every extraction, rule result, accept, override and field edit is written to an
append-only audit log that database triggers prevent from being edited or deleted.

**A14. Is the prototype secure enough to deploy tomorrow?**
No, and we say so on the Trust Report: the demo uses an officer switcher instead of logins, and
status links do not expire. A pilot would add government SSO, HTTPS on the state network, and a
security audit before real data.

### Offline & infrastructure

**A15. Manipur has had long internet shutdowns. Does it still work?**
Yes, except the reading step. The database, rules, name engine, queue, notices and audio all run on
the local machine; only the AI reading call needs the network. If that fails, the case goes to
Officer attention for manual entry — the officer types the fields and the same checks run without
AI.

**A16. Why not run a model fully on-premise?**
That is a deployment option we designed for: the AI is behind one interface. Today a hosted model
reads mixed handwriting and three scripts far better than what fits on a district office PC; a
pilot would test an on-premise or state-data-centre model against the same labelled test set.

**A17. What hardware does a district office need?**
One ordinary laptop or desktop runs the whole system, and any smartphone on the office network
uploads photos by scanning a QR code — no app install, no scanner. Production would run centrally
with the same web interface.

---

## Panel B — Government Relevance (14)

**B1. How does this fit with e-Seba?**
Thoudang is the scrutiny step, not a new portal. Applications that arrive through e-Seba or on paper
at the counter come to the officer's desk; Thoudang checks the packet and produces a structured,
audited result. Integration with e-Seba would be a pilot task — today it is standalone.

**B2. And with NSAP-PFMS and the Integrated Monthly Pension Processing System?**
Those systems pay beneficiaries; Thoudang works before them, so only clean records reach payment.
The CAG found Manipur NSAP cases paid twice and under-80s paid the 80+ rate — the duplicate check and
the age read from the documents address those at intake. We have not integrated with either system yet; we would export
approved cases in whatever format the department's processing system accepts.

**B3. Why does the Department need this now?**
The Old Age Pension alone has around 1,07,082 beneficiaries, and in 2019 the Director had to ask
people to keep the same name across bank, Aadhaar and voter ID. The Department's own lists of people
it could not pay run to over 2,000 names across four districts — mismatches cost real pensions.

**B4. Will this reduce officer workload or just add a screen?**
It replaces the slowest part — comparing names, dates and account details across four documents by
eye — with a pre-checked case and a list of specific issues. The queue puts clean cases in Ready, so
the officer spends time only where it is needed. A pilot would measure time per file before and
after.

**B5. Why no auto-reject? Wouldn't that be faster?**
Automated exclusion has gone wrong elsewhere: in Telangana's Samagra Vedika re-verification, 15,471
of 205,734 cases were approved — at least 7.5% had been wrongly excluded; in Haryana, 44,050 of
63,353 halted pensions were later found eligible. A pension is someone's income; the machine flags,
a person decides.

**B6. What does the citizen experience?**
A notice that says exactly which document and which field to fix, in English, Manipuri in Bengali
script and Meetei Mayek, with audio for those who cannot read. It can be printed, shared on
WhatsApp, and has a QR code that shows only the application's status.

**B7. Who wrote the Manipuri text? Can AI get it wrong?**
No AI writes citizen-facing text. Notices are filled from fixed templates; a native speaker reviews
each template on an admin page, and unreviewed or auto-transliterated Meetei Mayek is labelled
"pending review" on screen.

**B8. Are the eligibility rules correct?**
They are in a config file, not in code, and marked unverified, because official sources disagree on
the income ceiling. Day one of the pilot is confirming them with the Department; changing a rule
needs no programmer.

**B9. How are vulnerable applicants prioritised?**
Age 80+, widows, persons with disability and applicants with a relief-camp address move up the
queue, along with how long the case has waited. Priority only decides who is seen first — it never
affects eligibility.

**B10. How will you get officers to adopt it?**
It mirrors what they already do — check the packet, note deficiencies, forward to the DSWO — and
it never takes the decision away from them. Every override is recorded with a reason, which also
protects the officer during an audit.

**B11. How much training does an officer need?**
About an hour: upload, read the flags, accept or override with a reason, generate the notice. The
interface uses large type and plain-English reasons; a pilot would include on-site training and a
one-page guide.

**B12. Can the Department see the bigger picture?**
The dashboard shows which deficiencies citizens get wrong most, district-wise volumes and a priority
watch list. That tells the Department where to run awareness camps — for example, on name
consistency across documents.

**B13. What about duplicates and ghost beneficiaries?**
Each new case is compared with existing cases; a suspected duplicate forces officer review and
blocks any citizen notice until an officer looks. The CAG found 68 Manipur beneficiaries in its NSAP
sample getting more than one pension — this is the check for that.

**B14. What do you need from the Department for a pilot?**
One district office, three months, anonymised past files to tune the surname gazetteer, a
native-speaker reviewer for the notice templates, and confirmation of the scheme rules. Officers
keep deciding every case.

---

## Panel C — Industry Potential (14)

**C1. IDfy, Signzy and HyperVerge already do document verification. Why you?**
They are built for KYC: verifying one ID against a database for banks and fintechs. They do not
handle yumnak order, Ningol/Ongbi forms or "Kh."-style abbreviations, and they do not produce a
government scrutiny file with evidence, an audit trail and a Manipuri notice.

**C2. Couldn't a big company copy this?**
The model is a commodity; the hard part is the local knowledge — the gazetteer, abbreviation rules,
how women's names change at marriage, the department's forms and notice wording. That is built with
officers on the ground, which is where we are.

**C3. Is there any precedent for this in government?**
Himachal's HIMSeva, from May 2026, flags name and date-of-birth mismatches before submission —
the closest precedent. Nobody does it for North-East naming conventions.

**C4. What does it cost per application?**
Each document needs two AI calls — identify and read — so roughly eight per packet; the exact cost
per packet is printed by our evaluation run and I can read it off. Everything else runs on a local
machine at no per-use cost.

**C5. What is your business model?**
An annual licence per department, deployed on the state network or an India cloud region, with AI
usage passed through at cost. A pilot is free to the Department so the value is measured before any
spend.

**C6. Can it work for other schemes?**
Yes. Scheme rules live in a config file, and each document type is a schema plus a prompt — widow
pension, disability pension and other Social Welfare schemes reuse the same pipeline, name engine,
queue and notice system.

**C7. Scholarships?**
Scholarships have the same pattern: a form, an ID, a bank passbook, plus marksheets and income or
caste certificates. We would add those document types and rules; the name matching across documents
is the same problem.

**C8. What about TR-03 — transport documents?**
Driving licence and vehicle registration applications have the same core: read the documents,
cross-check names and dates, flag what is missing, let an officer decide. The pipeline is document-
agnostic; we would add the transport document schemas and rules.

**C9. Can other states use it?**
Every North-East state has naming patterns that generic tools get wrong — the gazetteer is
per-state data, not code. Outside the North-East, the rules engine, audit and no-reject design carry
over directly.

**C10. How does it scale to lakhs of applications?**
The AI reading step runs in parallel and the rest is lightweight code, so throughput is limited by
the API quota, not the design. The prototype already handles batch intake of many packets at once; a
state deployment would move from SQLite to a server database.

**C11. You are a solo founder. Can you deliver a state-wide system?**
I built this prototype end to end, with tests, an evaluation harness and a Trust Report. For a pilot
I would bring in a second engineer and a field coordinator from Imphal; for state roll-out we would
partner with the state's existing IT implementation agency.

**C12. What happens if Optivox disappears?**
The system is plain TypeScript with a local database, no lock-in, and the audit log and data stay
with the Department. We would offer source escrow or a government-owned licence as part of any
contract.

**C13. What is your moat if models get better and cheaper?**
Better models help us: reading gets more accurate and cheaper. Our value is the deterministic rules,
the Manipur name engine, the audit and notice workflow, and the trust record built with the
Department — none of that comes from the model.

**C14. What would make this pilot a failure?**
If officers override most flags, if it does not save time per file, or if any full Aadhaar number is
ever stored. All three are measurable from the audit log and the leak scan, and we would report
them honestly.
