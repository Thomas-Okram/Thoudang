# Cost model — AI cost per application vs officer time saved

> **Everything here is an estimate** built from stated assumptions. Replace the assumptions with
> pilot actuals (week 1 eval report + the first Bedrock bill) before quoting any figure. The
> Trust Report already shows measured cost per packet from `npm run eval`.

## 1. Variables

| Symbol       | Meaning                                                | Value used         | Source / how to update                                                                                                                                     |
| ------------ | ------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P_in`       | Input price, USD per million tokens                    | **$2**             | Claude Sonnet 5.5 list price (`PRICE_INPUT_PER_MTOK`). Bedrock India / Sonnet 5 pricing may differ — use the AWS price list for the profile actually used. |
| `P_out`      | Output price, USD per million tokens                   | **$10**            | Sonnet 5.5 list price (`PRICE_OUTPUT_PER_MTOK`)                                                                                                            |
| `R`          | INR per USD                                            | **₹88** (variable) | `PRICE_USD_INR`; set to the day's RBI reference rate                                                                                                       |
| `n`          | Images per application                                 | **4**              | form + Aadhaar + passbook + EPIC (EPIC optional → 3 is common)                                                                                             |
| `I`          | Visual tokens per image                                | **4,784**          | See §2 — worst case for a full phone photo                                                                                                                 |
| `T_c`, `O_c` | Classify call: text input / output tokens              | 500 / 150          | system + prompt; small JSON reply (effort low)                                                                                                             |
| `T_e`, `O_e` | Extract call: text input / output tokens               | 1,200 / 1,000      | prompt + field list; JSON with value, status, confidence, bbox per field (form has 18 fields), incl. any reasoning tokens at effort medium                 |
| `k`          | Overhead for retries, Bedrock repair turns, re-uploads | **10 %**           | Watch `audit_log` / eval report; repair turns re-send the image                                                                                            |

## 2. Image tokens (why 4,784)

Claude counts an image as `⌈width/28⌉ × ⌈height/28⌉` visual tokens. Thoudang resizes every photo
so the long edge is ≤ 2,576 px. A 4:3 phone photo becomes 2,576 × 1,932 px:

```
⌈2576/28⌉ × ⌈1932/28⌉ = 92 × 69 = 6,348 tokens
```

Sonnet 5.x is on the high-resolution tier, capped at **4,784 visual tokens** per image, so the model
downscales it to the cap → `I = 4,784`. Smaller inputs cost less: a 1,012 × 638 Aadhaar scan is
`37 × 23 = 851` tokens. Using the cap for every image makes this a **conservative** (upper) estimate.

## 3. Cost per application

### Scenario A — unsorted upload (classify + extract per image)

```
Input  per image = (I + T_c) + (I + T_e) = (4,784 + 500) + (4,784 + 1,200) = 11,268 tokens
Output per image = O_c + O_e             = 150 + 1,000                       =  1,150 tokens

Per application (n = 4):
  Input  = 4 × 11,268 = 45,072 tokens  → 45,072 × $2  / 1,000,000 = $0.090144
  Output = 4 ×  1,150 =  4,600 tokens  →  4,600 × $10 / 1,000,000 = $0.046000
  Subtotal                                                        = $0.136144
  + 10 % overhead (k)                     $0.136144 × 1.10         = $0.149758
  In rupees (R = 88)                      $0.149758 × 88           = ₹13.18
```

### Scenario B — labelled intake slots (officer picks the document type → no classify call)

```
Input  per image = I + T_e = 4,784 + 1,200 = 5,984 tokens
Output per image = O_e                     = 1,000 tokens

Per application (n = 4):
  Input  = 4 × 5,984 = 23,936 tokens   → 23,936 × $2  / 1,000,000 = $0.047872
  Output = 4 × 1,000 =  4,000 tokens   →  4,000 × $10 / 1,000,000 = $0.040000
  Subtotal                                                        = $0.087872
  + 10 % overhead                         $0.087872 × 1.10         = $0.096659
  In rupees (R = 88)                      $0.096659 × 88           = ₹8.51
```

General formula (paste into a spreadsheet):

```
cost_usd = (1 + k) × n × [ (I + T_e) × P_in + O_e × P_out
                           + classify × ((I + T_c) × P_in + O_c × P_out) ] / 1,000,000
cost_inr = cost_usd × R            (classify = 1 for unsorted uploads, 0 for labelled slots)
```

Cached re-runs (same image, same model and prompt version) cost **₹0** — the extraction cache is
keyed by image hash.

## 4. Monthly AI cost

| Applications / month | Scenario A (USD) | Scenario A (₹, R = 88) | Scenario B (USD) | Scenario B (₹, R = 88) |
| -------------------: | ---------------: | ---------------------: | ---------------: | ---------------------: |
|                1,000 |          $149.76 |                ₹13,179 |           $96.66 |                 ₹8,506 |
|               10,000 |        $1,497.58 |              ₹1,31,787 |          $966.59 |                ₹85,060 |
|             1,00,000 |       $14,975.84 |             ₹13,17,874 |        $9,665.92 |              ₹8,50,601 |

(`monthly = per-application cost × applications`; e.g. 10,000 × $0.149758 = $1,497.58; × 88 = ₹1,31,787.)

**Sensitivity:** every ₹1 change in `R` moves Scenario A by ₹0.15 per application. Using 3 images
(no EPIC) instead of 4 lowers both scenarios by 25 %. If real photos average 3,000 visual tokens
instead of 4,784, Scenario A falls to ≈ ₹10.4.

Not included: SDC VM and storage (state norms), AWS data transfer (small: ≈ 4 × 2 MB per
application), staff training, notice printing, and optional Gemini notice audio.

## 5. Officer time saved (estimate)

| Assumption                           | Value           | Basis                                                                                                                                                          |
| ------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual scrutiny time per application | 20 min          | **Estimate** — reading 3–4 documents, cross-checking names, Aadhaar, IFSC, age, income, writing a deficiency note. Replace with the week-1 stopwatch baseline. |
| Scrutiny time with Thoudang          | 7 min           | **Estimate** — open case, review highlighted evidence and flags, accept/override, approve or send notice. Pilot target.                                        |
| Time saved per application           | 13 min          | 20 − 7                                                                                                                                                         |
| Loaded cost of a Dealing Assistant   | ₹50,000 / month | **Estimate** — pay + allowances + overheads; replace with the department's figure                                                                              |
| Productive hours per month           | 160 h           | 20 days × 8 h                                                                                                                                                  |
| Cost per officer-minute              | ₹5.21           | 50,000 ÷ (160 × 60)                                                                                                                                            |
| Value of time saved per application  | **₹67.71**      | 13 × 5.21                                                                                                                                                      |

| Applications / month | Officer-hours saved | Full-time-equivalent staff freed | Value of time (₹) | AI cost, Scenario A (₹) | Ratio |
| -------------------: | ------------------: | -------------------------------: | ----------------: | ----------------------: | ----: |
|                1,000 |             216.7 h |                         1.35 FTE |           ₹67,708 |                 ₹13,179 | 5.1 × |
|               10,000 |           2,166.7 h |                         13.5 FTE |         ₹6,77,083 |               ₹1,31,787 | 5.1 × |
|             1,00,000 |          21,666.7 h |                        135.4 FTE |        ₹67,70,833 |              ₹13,17,874 | 5.1 × |

(`hours = applications × 13 ÷ 60`; `FTE = hours ÷ 160`.)

**How to read this:** the freed time is _capacity_, not a cash saving — no posts are cut. In
practice it shows up as a shorter backlog, faster sanction for elderly applicants, and officer
time for field verification of the hard cases. Break-even is at ≈ 2.5 minutes saved per
application (₹13.18 ÷ ₹5.21 per minute); the pilot measures the real figure.

Benefits not priced here (likely larger than the officer time): fewer repeat trips for citizens
because the first notice lists every defect, earlier pension start dates, and an auditable record
of every decision.

## 6. Keeping the bill predictable

- Use labelled intake slots / scanner folders (Scenario B) — saves ~35 %.
- Crop scans to the document; avoid full-frame photos of a card on a table (≈ 5× fewer tokens).
- Cap Bedrock spend with an AWS Budget alarm at 120 % of the monthly forecast.
- Track `cost.avgPerPacketUsd` from `npm run eval` on each release; prompt changes bump
  `PROMPT_VERSION` and are re-measured before deployment.
