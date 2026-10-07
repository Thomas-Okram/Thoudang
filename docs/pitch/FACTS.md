# Facts you may quote

**Rule:** say only what is on this page. If a judge asks for a number that is not here, say
"I don't have a verified figure for that — I can send it after the session."

Where a source column says _"(attach link)"_, the fact was verified while preparing the pitch but the
exact URL is not recorded in this repo. Paste the link in before the event so you can show it if asked.

## Do NOT quote

- **"Rs 104 crore"** — that was an advance announcement, not the amount distributed. Use Rs 91.66 crore (F1).
- Any accuracy, speed or cost figure for Thoudang that is not on the Trust Report screen or in the
  latest `npm run eval` output. Read those numbers off the screen; do not memorise old ones.
- Any claim of an existing integration with e-Seba, PFMS or the Integrated Monthly Pension
  Processing System. Say "designed to hand off to", not "integrated with".
- "DPDP compliant". Say **"designed to DPDP standards"** (F10).

## Manipur — scale of the problem

| #   | Fact (quote exactly)                                                                                                                                                                                              | Source                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| F1  | On **22 Jul 2026** the Chief Minister distributed **Rs 91.66 crore** to nearly **2,40,758 beneficiaries** under **17 Social Welfare schemes**, and launched the **Integrated Monthly Pension Processing System**. | EastMojo; NE Now (22 Jul 2026) (attach links)                                            |
| F2  | Manipur Old Age Pension: around **1,07,082 beneficiaries** (July 2026).                                                                                                                                           | (attach link — same coverage as F1)                                                      |
| F3  | CAG Manipur, Report 2 of 2022: _"All 100 selected beneficiaries received their pensionary benefits with delays ranging from four months to 44 months."_                                                           | Comptroller and Auditor General of India, Report No. 2 of 2022, Govt of Manipur          |
| F4  | CAG NSAP audit (Report 10 of 2023), Manipur sample: **68** beneficiaries got more than one pension; **89** beneficiaries under 80 were paid the 80+ rate.                                                         | Comptroller and Auditor General of India, Report No. 10 of 2023 (NSAP performance audit) |
| F5  | Oct 2019: the Social Welfare Director urged beneficiaries to _"maintain same name and address in Bank account/Pass Book, Aadhar card and voter i/card"_.                                                          | The Morung Express, Oct 2019 (attach link)                                               |
| F6  | The Department's own published lists of beneficiaries it could not pay: **over 2,000 names across four districts**.                                                                                               | Department of Social Welfare, Manipur — published lists (attach links)                   |
| F7  | Internet suspended for **385 days** since **3 May 2023**, in all or part of the state.                                                                                                                            | (attach link — shutdown tracker used during research)                                    |

## Precedents elsewhere

| #   | Fact                                                                                                                                                                      | Source        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| F8  | Telangana **Samagra Vedika**: of **205,734** re-verified cases, **15,471** were approved — at least **7.5%** had been wrongly excluded.                                   | (attach link) |
| F9  | Haryana **Parivar Pehchan Patra (PPP)**: **44,050 of 63,353** halted pensions were later found eligible.                                                                  | (attach link) |
| F11 | Himachal **HIMSeva** (May 2026) flags name/DOB mismatches before an application is submitted — the closest precedent. Nobody does this for North-East naming conventions. | (attach link) |

How to use F8/F9: _"Automated exclusion has already gone wrong elsewhere — that is why Thoudang has
no reject status."_

## Law

| #   | Fact                                                                                                                                                                                           | Source                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| F10 | The **Digital Personal Data Protection Rules** were notified on **13 Nov 2025**; the substantive duties apply from **mid-May 2027**. So say **"designed to DPDP standards"**, not "compliant". | MeitY, Gazette notification of DPDP Rules, 13 Nov 2025 |

## The name example

| #   | Fact                                                                                                                                        | Source                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| F12 | In the **2022 Manipur Assembly election**, **Khuraijam Loken Singh** and **Khwairakpam Loken Singh** both shorten to **"Kh. Loken Singh"**. | Election Commission of India, 2022 Manipur Assembly candidate lists (attach link) |

## Facts about Thoudang itself (from this repo — safe to say)

| Fact                                                                                                                       | Where it comes from                                               |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Statuses are only Ready / Needs citizen correction / Officer attention / Approved by officer. There is no reject.          | `packages/core/src/types.ts`, Trust Report §3                     |
| Aadhaar is masked to the last 4 digits immediately after reading; only a checksum-valid flag is kept.                      | `apps/api/src/extraction/normalise.ts`, Trust Report §3 live scan |
| Only the DSWO role can approve; every accept/override is in an append-only audit log (SQLite triggers).                    | `apps/api/src/officers.ts`, migration 0001                        |
| Citizen notices use zero AI calls — they are filled from proofread templates.                                              | `packages/core/notices/templates.json`, Trust Report §3           |
| Starter gazetteer: **116 surnames** (Meitei 64, Kuki-Zo 27, Naga 22, Pangal 3).                                            | `packages/core/data/gazetteer.json`                               |
| Fairness dev set: **58 labelled name pairs** (in-sample — written alongside the engine).                                   | `packages/core/data/fairness-dev.json`                            |
| All demo data is synthetic and marked SPECIMEN.                                                                            | `eval-data/`, Trust Report §5                                     |
| Rule thresholds (age 60+, income ceiling) are a config file and are **marked unverified** pending department confirmation. | `packages/core/config/schemes.json`                               |
