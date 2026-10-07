# Pilot plan — Imphal West, 8 weeks

**Scope:** Old Age Pension applications (IGNOAPS / state old-age pension) received at the
**District Social Welfare Office, Imphal West**. One district, one scheme, one office.
**Mode:** Thoudang runs _alongside_ the existing manual scrutiny for the first 3 weeks
(shadow mode), then becomes the primary scrutiny desk with the DSWO's sign-off on every case.
Nothing is ever auto-rejected; every sanction remains a human decision.

Deployment: [SDC-DEPLOYMENT.md](SDC-DEPLOYMENT.md) · Costs: [COST-MODEL.md](COST-MODEL.md) ·
Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)

## 1. Objectives

1. Cut officer scrutiny time per application without lowering the quality of decisions.
2. Raise **first-time-right** — applications that need no second visit by the citizen — by
   telling citizens exactly what to fix, in Manipuri, the first time.
3. Prove the safeguards work in a real office: Aadhaar masking, audit trail, human approval,
   no automated rejection, fair name matching across Meitei, Naga, Kuki-Zo, Pangal and other communities.
4. Produce the evidence the department needs to decide on a state-wide rollout.

## 2. Roles

| Role                     | Who                                                                 | Responsibility                                                                 | Time                       |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| Pilot sponsor            | Director, Social Welfare                                            | Approves pilot, exit decision                                                  | 2 h / fortnight            |
| Pilot owner              | DSWO Imphal West                                                    | Final approval of every case; signs weekly report                              | 30 min / day               |
| Scrutiny users           | 2 Dealing Assistants                                                | Intake, review flags, draft notices                                            | daily use                  |
| Language reviewer        | 1 native Meiteilon speaker (dept. staff or DIET/University faculty) | Proof-reads all notice templates (Bengali script + Meetei Mayek) before week 3 | 2 days, then 1 h / week    |
| Technical owner          | Thoudang developer                                                  | Deployment, fixes, weekly metrics                                              | 50 % weeks 1–4, 20 % after |
| SDC / NIC liaison        | State Data Centre team                                              | VM, network, backups, TLS                                                      | as needed                  |
| Data protection reviewer | Department nodal officer (DPDP / IT)                                | Signs off data flows, retention, Bedrock India usage                           | 1 day + reviews            |
| Independent checker      | Officer from another district                                       | Blind re-scrutiny of a 10 % sample                                             | 2 h / week                 |

## 3. Timeline

| Week             | Phase              | Activities                                                                                                                                           | Gate to continue                                                       |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0 (before start) | Approvals          | Data-protection review, AWS Bedrock access in ap-south-1, SDC VM request, officer nominations                                                        | Written approval of data flows                                         |
| 1                | Setup              | Deploy on SDC VM, TLS, backups, Bedrock eval on 30 labelled SPECIMEN packets; record **manual baseline** (time 50 applications done the current way) | Health green; eval accuracy within 1 pt of baseline; baseline captured |
| 2                | Training + dry run | Training (below); officers process last month's **already-decided** files (re-photographed, consented) — results compared with actual decisions      | Officers complete the practical test; no critical defects              |
| 3                | Shadow mode        | All new applications go through Thoudang **and** manual scrutiny; DSWO decides on the manual file; disagreements logged                              | Language reviewer has approved all templates (`reviewed: true`)        |
| 4–5              | Assisted live      | Thoudang is the primary desk; DSWO approves in Thoudang; independent checker re-scrutinises 10 % blind                                               | Override rate stable; no missed ineligibility in the sample            |
| 6–7              | Steady state       | Normal operation; notices printed + status links sent; weekly metric review; fix top-3 friction points                                               | Metrics trending to targets                                            |
| 8                | Evaluation         | Final metrics, officer survey, citizen feedback sample, cost actuals, exit decision meeting                                                          | Exit criteria (§7)                                                     |

## 4. Success metrics

Measured weekly from the audit log (`audit_log`, case timestamps) plus a stopwatch baseline.

| Metric                             | Definition                                                                                                              | Baseline (week 1)                                              | Target (week 8)                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Screening time per application** | Officer active time from opening the case to decision-ready (Ready / notice drafted / approved). Median and p90.        | Manual stopwatch on 50 files (expected 15–25 min — _estimate_) | Median **≤ 7 min**, i.e. ≥ 60 % reduction                                                                            |
| **First-time-right %**             | Applications approved without any citizen correction round ÷ applications decided                                       | From last quarter's register (resubmissions)                   | **+15 points** over baseline                                                                                         |
| **Notices sent**                   | Deficiency notices issued (print or link) ÷ cases in _Needs citizen correction_; and median days from receipt to notice | Today: verbal / ad-hoc                                         | **≥ 95 %** of correction cases get a written notice within **2 working days**                                        |
| **Officer override rate**          | Flags overridden ÷ flags raised (by flag code)                                                                          | —                                                              | **5–20 %**. Below 5 % may mean rubber-stamping; above 20 % for a flag code means the rule or extraction needs fixing |
| Field extraction accuracy          | Officer edits ÷ fields extracted (FIELD_EDITED audit)                                                                   | Eval set number                                                | ≤ 5 % of fields edited                                                                                               |
| Safety: missed ineligibility       | Cases approved in Thoudang that the independent checker finds ineligible                                                | —                                                              | **0**                                                                                                                |
| Safety: Aadhaar leakage            | `npm test` leak scan + DB/log scan on the live volume (weekly)                                                          | —                                                              | **0** full numbers stored                                                                                            |
| AI availability                    | Extractions that failed → officer attention ÷ total                                                                     | —                                                              | ≤ 2 %                                                                                                                |
| AI cost per application            | Bedrock bill ÷ applications                                                                                             | Model: ₹8.5–13 (COST-MODEL.md)                                 | Within ±30 % of model                                                                                                |
| Officer satisfaction               | 5-question survey, 1–5 scale                                                                                            | —                                                              | ≥ 4.0                                                                                                                |

## 5. Hardware & connectivity

| Where       | What                                                                                                     | Qty                     |
| ----------- | -------------------------------------------------------------------------------------------------------- | ----------------------- |
| SDC         | VM 4 vCPU / 8 GB / 250 GB encrypted (see SDC-DEPLOYMENT.md)                                              | 1 (+1 standby snapshot) |
| DSWO office | Desktop / laptop with Chrome or Edge, 1080p+ screen                                                      | 3 (2 DAs + DSWO)        |
| DSWO office | Flatbed or document scanner (A4, 300 dpi, scan-to-folder) **or** a phone stand + office phone for photos | 2                       |
| DSWO office | Laser printer for notices                                                                                | existing                |
| DSWO office | Network to SDC (SWAN / broadband + VPN), ≥ 10 Mbps; 4G dongle as backup                                  | 1 + 1                   |
| DSWO office | UPS for desktops + router (power cuts)                                                                   | 3                       |

Budget estimate (one-off, excl. existing items): scanners ₹60,000, UPS ₹30,000, dongle ₹3,000.
Recurring: SDC VM per state norms; AI usage per COST-MODEL.md (≈ ₹10,000–30,000 / month at pilot volumes).

## 6. Training (week 2)

| Session                 | Audience               | Length | Content                                                                                                                                                      |
| ----------------------- | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Why and what            | All + sponsor          | 1 h    | "AI reads, code decides, you decide." What the AI can and cannot do. No rejections.                                                                          |
| Hands-on intake → queue | DAs, DSWO              | 3 h    | Upload a packet, read the queue, open a case, evidence highlights, accept / override with reason, edit a misread field, approve (DSWO). 10 practice packets. |
| Notices                 | DAs, language reviewer | 1 h    | Drafting, printing, status links; reviewing templates on `/admin/templates`.                                                                                 |
| Safeguards              | All                    | 45 min | Aadhaar masking, audit drawer, Trust Report, when to escalate, how to report a wrong AI reading.                                                             |
| Practical test          | DAs, DSWO              | 30 min | Process 5 unseen packets correctly, including one duplicate and one name mismatch.                                                                           |

Materials: one-page quick guide in English + Manipuri, 5-minute screen recording, WhatsApp help
group with the technical owner (response within 2 working hours during the pilot).

## 7. Exit criteria (week 8 decision)

**Scale up** (to 3–4 more districts) if all of:

- Median screening time reduced ≥ 50 % against the week-1 baseline.
- Zero missed ineligibility in the independent 10 % sample; zero Aadhaar numbers stored.
- First-time-right improved ≥ 10 points, and ≥ 90 % of correction cases received a written notice.
- Override rate between 5 % and 20 % overall, with no flag code above 30 %.
- DSWO and both DAs would choose to keep using it (survey ≥ 4.0).
- Data-protection reviewer signs off the operating evidence.

**Extend the pilot** (4 more weeks, same district) if safety criteria pass but time / first-time-right targets are missed.

**Stop** if any of: a missed ineligibility traced to the system that the safeguards should have
caught; a confirmed Aadhaar leak; sustained AI failure rate > 10 %; officers unable to work
faster than manual after week 5. Data is exported for the department and the VM wiped per the
retention agreement.

## 8. Risks

| Risk                                                                                    | Mitigation                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Officer identity is a header today (prototype)                                          | Pilot only on the department network / VPN behind SDC SSO; add real login before scale-up.                                                                                                                                                                                                         |
| Poor photos (glare, folds)                                                              | Scanner at the desk; legibility flags route to officer, never to a citizen notice.                                                                                                                                                                                                                 |
| Name-engine bias for communities with few examples                                      | Fairness hold-out set from real (consented, anonymised) pairs collected in weeks 3–5; publish per-community table on the Trust Report.                                                                                                                                                             |
| Bedrock India model differs from the API model (Sonnet 5 vs 5.5, no structured outputs) | Week-1 eval gate; repair turn; officer edits tracked as a metric.                                                                                                                                                                                                                                  |
| Connectivity at the DSWO office / SDC egress                                            | 4G backup at the office; paper intake continues during an outage and packets are uploaded when the link returns. If Bedrock is unreachable, cases land in _Officer attention_ ("extraction failed") and are scrutinised manually — nothing is lost, but no automatic re-run exists yet (proposal). |
| Templates not yet proof-read                                                            | Shadow mode cannot end until every template is `reviewed: true`.                                                                                                                                                                                                                                   |
