# Holdout v2 — fresh blind name pairs (for department staff)

**Why this exists.** Thoudang checks whether the names on an application packet (form, Aadhaar, bank
passbook) belong to the same person. We measured it on a blind set of 160 pairs (holdout v1). It wrongly
merged 9 pairs of _different_ people with near-identical given names (like Tomba / Thoiba). We fixed the
rule on 8 Oct 2026. Because the fix was made after seeing v1, **v1 can no longer give an honest number.**
We need a new set that nobody on the build side has seen. That is this folder.

## What to do (about 1–2 hours for 2–3 people)

1. Open `holdout-v2-pairs.csv` in Excel, LibreOffice or Google Sheets. It has only the header row.
2. Add **one row per pair of names**: two ways a name might appear on two documents in one packet.
3. Save as **CSV (comma-separated, UTF-8)** with the same file name and the same header.
4. Give the file back. Please do **not** run the tool or look at its results first.

Aim for **at least 40 pairs per community** (160+ in total) and roughly a third each of `true`, `false`
and a smaller number of `ambiguous`.

## Columns

| column          | what to write                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `name_a`        | a name as it might be written on one document (form, Aadhaar, passbook, voter ID)                  |
| `name_b`        | the name as it might be written on another document                                               |
| `community`     | exactly one of: `Meitei`, `Pangal`, `Naga`, `Kuki-Zo` (write the sub-tribe in `note` if you like) |
| `expected_same` | `true` (same person), `false` (different people) or `ambiguous` (you cannot tell from names alone) |
| `note`          | optional: what the pair tests, e.g. "yumnak abbreviated", "brothers"                              |

**Do not use commas inside a cell.** Use a dash instead (`brothers - names one letter apart`).

**`true`** = a careful dealing assistant who saw both names in one packet would treat them as the same
applicant. **`false`** = different people. **`ambiguous`** = even an experienced officer would need more
evidence (for example a married name with no link to the maiden name).

## Format examples (made up — do not copy them into the file)

```
name_a,name_b,community,expected_same,note
Sapam Nongdren Singh,S. Nongdren Singh,Meitei,true,yumnak abbreviated
Sapam Nongdren Singh,Sapam Nongdrei Singh,Meitei,false,cousins - given names one letter apart
Akoijam Memcha Devi,Huidrom Ongbi Memcha Devi,Meitei,ambiguous,married name - no link shown
```

## What to include

Please write from **your own experience of real files**, not from these instructions. Mix:

- **Same person, written differently:** yumnak/clan abbreviated (`Kh.`, `Th.`, `L.`), family name
  first or last, Singh/Devi/Chanu/Meitei added or dropped, Ningol/Ongbi forms, Md./Mohd./Mohammad,
  spelling habits of different offices (bank capitals, Aadhaar English, hand-written forms), common
  romanisation differences you see in your work.
- **Different people who look alike:** brothers and sisters, father and son, two people with the same
  given name in different clans, given names one or two letters apart, near-identical clan names.
- **Hard cases:** married names, initials only, missing clan, nicknames — label these honestly,
  `ambiguous` if you cannot tell.
- Every community: Meitei, Meitei Pangal, Naga (any tribe), Kuki-Zo (any tribe).

## Rules that keep the number honest

- **Fictional names only.** Combine common clan names with common given names. Do not copy a real
  applicant's name from a file. Avoid well-known public figures.
- **Do not look at** the name engine code (`packages/core/src`), its tests, the gazetteer, the
  development set (`fairness-dev.json`) or holdout v1 (`eval-data/holdout/`) while writing.
- **Do not change a label after seeing the tool's result.** If you think a label was wrong, note it in
  a separate list and tell the team. Don't edit the file.
- The build team must **never tune the engine on v2.** Once its results lead to an engine change, v2
  becomes "seen" like v1, and a v3 is needed before quoting a held-out number again.

## Importing (build team)

```
npm run fairness -- --holdout ./eval-data/holdout-v2/holdout-v2-pairs.csv
```

Rows with mistakes are listed by row number and nothing is imported until they are fixed. The result
goes to `packages/core/data/fairness-holdout-v2.json` and appears on the Trust Report as
**Holdout v2 (blind)**, above holdout v1 (pre-fix). Commit both the CSV and the JSON.
