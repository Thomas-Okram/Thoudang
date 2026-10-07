# Thoudang — Data-protection mapping

> **Not legal advice.** This maps what the prototype does to the obligations we believe apply,
> so the Social Welfare Department's legal/IT teams can review it. It is a hackathon prototype
> running on **synthetic SPECIMEN data**. Thoudang is **designed to DPDP standards**; it does not
> claim to be "compliant" with any law. Citations are to our best reading; confirm with counsel.

## 1. Data we handle (and do not)

| Data                                                | Stored?                         | Form                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aadhaar number                                      | **No**                          | Last 4 digits + "checksum valid yes/no". Full number exists only inside the uploaded images and transiently in memory/Claude's reply before masking. |
| Document images                                     | Yes, until retention purge      | GPS removed; served to officers only redacted (Aadhaar number boxed or card blurred)                                                                 |
| Name, DOB, address, bank account/IFSC, EPIC, income | Yes                             | Extracted fields with confidence + evidence                                                                                                          |
| Officer decisions                                   | Yes, append-only + hash-chained | Who, when, before/after, reason                                                                                                                      |
| Biometrics, Aadhaar authentication / e-KYC          | **Never**                       | No UIDAI API is called                                                                                                                               |

## 2. Aadhaar Act, 2016 and UIDAI regulations/directions

| Obligation (our reading)                                                                                                                                                                                             | Thoudang safeguard                                                                                                                                                                                                  | Where                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Do not publish/display a record containing full Aadhaar numbers unless redacted or blocked (Aadhaar (Sharing of Information) Regulations, 2016, reg. 6; UIDAI "masked Aadhaar" convention: only last 4 digits shown) | Masked to `XXXX XXXX 1234` in `normaliseExtraction` **before** the cache, DB, logs, SSE or API see it; Verhoeff check computed in memory, number discarded                                                          | `packages/core` `maskAadhaar` / `redactAadhaarInText`; `apps/api/src/extraction/normalise.ts` |
| Do not store Aadhaar numbers in plain databases (UIDAI Aadhaar Data Vault circular, 2017, for entities that must store them)                                                                                         | We go further: the number is **never stored**, so no vault is needed                                                                                                                                                | same                                                                                          |
| Collect only for the stated purpose; Aadhaar for State benefits under s.7                                                                                                                                            | Used only to match the applicant across form/card/passbook and flag duplicates (last-4 + DOB + name)                                                                                                                | `packages/core/src/rules`                                                                     |
| Images of the card are themselves sensitive                                                                                                                                                                          | Images served only redacted from the server; originals never served; intake previews blurred until the number is located; images deleted after retention period                                                     | `services/redact.ts`; `routes/sessions.ts`; `security/retention.ts`                           |
| Logs must not leak the number                                                                                                                                                                                        | Every log line passes through `redactAadhaarInText`; leak scanner (Trust Report) scans DB rows, logs and live API responses — **0 findings** in tests, including a raw scan of the SQLite file with the audit chain | `logger.ts`, `leak-scan.ts`, `test/aadhaar-leak.test.ts`, `test/security-http.test.ts`        |

## 3. Digital Personal Data Protection Act, 2023 (and DPDP Rules, 2025)

The Act's substantive Data Fiduciary duties commence under the Rules' phased timeline
(**mid-May 2027**). Until then this is a design target, not a legal requirement on the prototype.

| DPDP duty (our reading)                                                                                         | How Thoudang is designed for it                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lawful ground — State "legitimate use" for providing a subsidy/benefit (s.7(b))                                 | Processing is limited to screening an application the citizen submitted for the Old Age Pension; no secondary use, no marketing, no profiling beyond case priority                                                     |
| Purpose limitation & data minimisation (s.4–6)                                                                  | Only fields needed by the scheme rules are extracted; Aadhaar reduced to last 4; GPS stripped from photos; no biometrics                                                                                               |
| Accuracy (s.8(3)) — data used to make a decision affecting the person must be complete and accurate             | Every field carries evidence + confidence; low-confidence citizen flags are re-routed to an officer; **AI reads, code decides, a human makes the final call**; there is no "reject" status                             |
| Reasonable security safeguards (s.8(5); Rules: encryption/masking, access control, logging, monitoring)         | Masking; PIN sessions with role-based permissions on the API; strict CSP/headers; LAN-locked CORS; rate/size limits; magic-byte upload checks; append-only, hash-chained audit log with `npm run audit:verify`         |
| Breach intimation to the Board and affected persons (s.8(6); Rules: without delay, detailed report within 72 h) | Not automated. Tamper evidence (`audit:verify`), leak scanner and JSON logs support detection; incident procedure in §5                                                                                                |
| Erase when the purpose is served (s.8(7))                                                                       | `RETENTION_DAYS` job deletes images after a case is closed; masked fields + audit kept as the decision record. **Open:** retention period for the record itself must follow the Department's record-retention schedule |
| Rights: access, correction (s.11–12)                                                                            | Citizen status link shows reference, given name and coarse status; corrections flow through the deficiency notice (English + Manipuri, audio)                                                                          |
| Retain logs (Rules: one year)                                                                                   | Audit log is append-only and never purged; JSON logs are not rotated or deleted by the app                                                                                                                             |

## 4. CERT-In Directions, 28 April 2022 (s.70B(6), IT Act)

| Direction                                                         | Status                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report cyber incidents to CERT-In within **6 hours** of noticing  | Procedure in §5. The app surfaces the signals (tamper alarm in the log, leak scanner, refused uploads, sign-in failures).                                                                            |
| Maintain ICT system logs for a rolling **180 days**, within India | `apps/api/logs/api.log` (JSON lines, Aadhaar-redacted) + `audit_log` stay on the host in India. **To do for production:** log rotation with ≥ 180 days kept, shipped to the Department's log server. |
| Synchronise clocks with NIC/NPL NTP                               | Host-level setting (`time.nplindia.org` / NIC NTP) — not app code. Audit timestamps come from the host clock.                                                                                        |
| Designate a point of contact                                      | Department responsibility.                                                                                                                                                                           |

## 5. MeitY cloud & data-residency guidance

| Guidance (our reading)                                                           | Thoudang                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Government data hosted in India; use MeitY-empanelled cloud / GI Cloud (MeghRaj) | Database, images, logs and audit are on the local machine (no cloud DB; works offline).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| —                                                                                | **Gap:** each document image (including the Aadhaar card, which shows the full number) is sent over TLS to the Claude API, which is not hosted in India; notice text goes to Gemini TTS. Acceptable for synthetic SPECIMEN data only. **Before real data:** route model calls through an India-hosted, MeitY-empanelled deployment (verify current regional availability), or mask the Aadhaar region on-device before upload, and sign a data-processing agreement with no-training/no-retention terms. |

## 6. Incident response (prototype)

1. Stop the API (`Ctrl+C`); keep `data/`, `logs/`, `uploads/` as they are (evidence).
2. Run `npm run audit:verify` and the Trust Report leak scan; record the output and time.
3. Report to the Department's CISO / CERT-In within 6 hours of noticing (CERT-In), and assess
   DPDP intimation to affected persons and the Board.
4. Rotate `SESSION_SECRET`, `OFFICER_PINS`, `AUDIT_CHAIN_KEY`, `STATUS_LINK_SECRET`, API keys.

## 7. Configuration checklist before any real data

- [ ] `AUTH_MODE=session`, unique `OFFICER_PINS` (or SSO), long random `SESSION_SECRET`
- [ ] `AUDIT_CHAIN_KEY` from a secrets store, anchor heads shipped off-box
- [ ] HTTPS (then enable HSTS in `middleware/security-headers.ts`); full-disk encryption
- [ ] `RETENTION_DAYS` set to the Department's schedule; log rotation ≥ 180 days
- [ ] India-hosted model endpoint (see §5); NTP to NIC/NPL
