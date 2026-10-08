# Holdout v1 — name-pair set (written blind, now SEEN)

> **Status: seen since 8 Oct 2026.** This set found 9 false matches (near-identical given names). Those
> results led to the given-name rule, so v1 is no longer a held-out measurement. It stays here unchanged,
> and the Trust Report shows it as **"Holdout v1 (pre-fix)"** with before/after numbers. The fresh blind
> set is [`../holdout-v2/`](../holdout-v2/README.md).

`holdout-pairs.csv` contains 160 **fictional** name pairs for checking the Manipur-aware name engine on
data it was not written against. It is already imported (`packages/core/data/fairness-holdout.json`);
`npm run fairness` reports it. (`--holdout` now always imports into holdout v2, so v1 cannot be
overwritten.)

## How it was written

- Written **blind** by an independent session that was told not to open, and did not open, the name
  engine (`packages/core/src`), its tests, the gazetteer (`packages/core/data/gazetteer.json`) or the
  in-sample `fairness-pairs.json`. The pairs come from general knowledge of how names are written in
  Manipur, not from what the engine handles.
- Every name was made up. Common clan names / yumnaks / sageis are combined with invented or common
  given names. If a combination matches a real person, that is a coincidence. Well-known public
  figures' names were avoided on purpose.
- The labels were not changed after any engine run. (No engine run was made while writing them.)

## Columns

| column | meaning |
|---|---|
| `name_a`, `name_b` | the two names as they might appear on two documents in one application packet |
| `community` | `Meitei`, `Meitei Pangal`, `Naga`, `Kuki-Zo` (sub-tribe is in `note`) |
| `expected_same` | `true` / `false` / `ambiguous` |
| `note` | which variant or trap the pair tests (no commas, so the CSV has no quoted fields) |

**What `true` means.** "A careful dealing assistant who sees both names in one packet would treat them as
the same applicant." It does not mean that the strings alone prove it. In particular, a family name cut
down to an initial or a short abbreviation (`L.`, `Th.`, `Kh.`, `Ch.`, `G.`, `H.`) with an identical given
name is labelled `true`. If the engine answers AMBIGUOUS for these, that is the cautious answer and you
could argue it is right. Decide how to score AMBIGUOUS against `true` before you quote a number.

**What `ambiguous` means.** Even a human cannot decide without more evidence: a married name with no link
to the maiden name, a given name reduced to an initial, a clan missing from one document, a possible short
form or nickname, or two equally plausible spellings.

## Breakdown

| community | pairs | true | false | ambiguous |
|---|---|---|---|---|
| Meitei | 50 | 22 | 23 | 5 |
| Meitei Pangal | 30 | 13 | 14 | 3 |
| Naga (Tangkhul, Rongmei, Liangmai, Mao, Poumai, Maram, Zeme, Maring, Anal) | 40 | 18 | 19 | 3 |
| Kuki-Zo (Thadou, Paite, Hmar, Vaiphei, Zou, Gangte, Kom, Simte) | 40 | 18 | 18 | 4 |
| **total** | **160** | **71** | **74** | **15** |

Variants covered (same person): family name cut to an abbreviation or initial; family name first vs last;
Singh/Devi/Chanu/Leima/Meitei/Meetei suffix added, dropped or swapped; Ningol/Ongbi married form vs maiden
name; Md./Mohd./Mohammad/Mohammed; sagei first vs last; tribe name as a suffix (`Zeme`, `Maring`, `Hmar`);
honorifics `Pu`/`Pi`; romanisation (s/sh, Lh/Hl, ou/o, ii/i, n/ng, K/Q, mai/me, trailing h/g); split or
joined given names; ALL CAPS, double spaces, trailing full stops.

Traps (different people): same family name with a different given name; same given name with a different
family name (men only, because women's family names can change); near-identical given names (Tomba/Thoiba,
Ibemcha/Ibemhal, Hamid/Hakim, Amir/Amin, Lianzamang/Lianzamung); near-identical clans (Chongtham/Chingtham,
Pamei/Panmei, Sorokhaibam/Soraisam); father and son; brothers and sisters, including gendered endings
(Tomba/Tombi, -lung/-liu, Hmar -a/-i).

## Known limitations

- **One author, not native speakers.** The pairs reflect one writer's general knowledge. They are not checked
  by people from each community. Sub-tribe conventions (especially Mao, Poumai, Maram, Zeme, Maring, Anal,
  Kom and Pangal sagei names) are less certain than Meitei, Tangkhul, Thadou and Paite ones. Some
  "romanisation variant" pairs may look odd to a native speaker. Ask DSWO staff to review before relying on
  per-community numbers.
- **Small samples.** 30–50 pairs per community gives wide confidence intervals. A difference of a few
  percentage points between communities does not mean much.
- **Label judgement calls.** Abbreviations are labelled `true` (see above). Chanu vs Devi and Begum vs Begam
  are labelled `true`, and Begum vs Khatun is labelled `ambiguous`. Other reviewers might draw these lines
  differently.
- **Pairs only.** There is no packet context (relatives' names, dates of birth, addresses). Some
  `ambiguous` pairs would be resolved in a real packet.
- **Fictional, not sampled.** These are not drawn from real application data, so how common each pattern is
  here does not match real life.
- **Blindness is a single-use property.** Once the engine is tuned on these pairs, the set is no longer
  held out. Write a fresh set before quoting a held-out number again.
