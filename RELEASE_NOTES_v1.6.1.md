# INDAS XBRL Tool v1.6.1 — release notes

Base: v1.6. Reported: a next-year standalone filing with 37 errors. 31 are data in the filing (see the answer given with
this release); six came from three weaknesses of the tool, fixed here. Details: README, section "v1.6.1".

## What changed

| # | Before | v1.6.1 |
|---|---|---|
| 1 | FM-15 "At least one child member of {Other loans and advances} should be present" although *Other loans and advances – others* is reported (MCA's exemption sheet names that child as exempted, and the tool stopped counting it) | Any child that is reported counts as present. Your project: the 2 errors (and 3 warnings) go |
| 2 | A figure finer than the accuracy it was imported with (share capital 689.8357 lakhs declared to thousands, Filing Manual #13) could not be corrected by typing it again | Typing it again takes the accuracy the figure needs; **Fix: Declare its own accuracy** on the message does it in one click (the value does not change) |
| 3 | Numbered members with a gap (Shareholder 1, 2, 3, 4, 6, 7, 8) — every value had to be re-entered under another number | **Fix: Close the gap** on the GR-3 message: the values of the last member move to the missing number, in every table, that year only. The message now opens the table |

## Files

New: `audit-v161.test.mjs`, `RELEASE_NOTES_v1.6.1.md`.

Changed: `rules.js`, `model.js`, `session.js`, `fixes.js`, `shell.html`, `package.json`, `README.md`, and the generated
`index.html`, `indas-xbrl.html`, `artifact.html`, `BUILD_INFO.json`.

## Your project

1. Validation → shareholders, current year: remove the column of Shareholder 1 ("NA"). Then **Fix: Close the gap** on
   each GR-3 message (current year twice, previous year once).
2. **Fix: Declare its own accuracy** on the two share-capital messages (previous year).
3. **Fix: Report nil (0)** on each GR-5 message.
4. By hand (data): clear the stray 0 in *Number of shares held* (previous year, no shareholder); related party E,
   previous year: nature of relationship *Relative*; PPE current year: clear the zeros of *Other building* in *Decrease
   through classified as held for sale* (or enter 0 under *Buildings*); deferred tax, previous year: opening deferred tax
   asset (31-03-2024, other temporary differences 1) back to 1,199.44 as filed last year.

Checked on your project: after steps 1–3 seven errors are left, exactly those of step 4.

## Tests

| Suite | Result |
|---|---|
| Your project | 37 → 35 errors on opening (FM-15 gone); steps 1–3 leave the 7 of step 4. Your two projects of last week: unchanged |
| Unit (`npm run test:unit`) | 285 / 285 (3 new in `audit-v161.test.mjs`) |
| Gate / Golden / Assurance | 11 / 11, 35 / 35, 37 / 37 |
| Browser (`browser-smoke.mjs`) | 182 / 182 |
| Rule audit (`RULE_AUDIT.json`) | every rule as in v1.6 |
| Reference instances' XML | byte-identical to v1.6 (all four, directly and through the health check) |
| Clean unzip of the package (no golden files) | recompiles the authority identically, builds the same `index.html`; unit 248 / 248 (9 golden-only skipped), gate 10 / 10 (1 golden-only skipped), browser 132 / 132 |

## Not run here

- The MCA validator on the corrected filing.
- As before: `npm ci` with the pinned packages, the real XML parser, `xsd.test.mjs` / Arelle, the deployed site.

## Manual check (10 minutes)

1. The title reads **INDAS XBRL Tool v1.6.1**.
2. Open your project, validate: no FM-15 error on borrowings.
3. Remove the current-year column of Shareholder 1; validate; **Fix: Close the gap** on a GR-3 message — the dialog
   names the members; confirm. The shareholder moves to the missing number in both shareholder tables.
4. Repeat until no GR-3 / FM-16 message is left (current and previous year).
5. **Fix: Declare its own accuracy** on the share-capital messages: the figure stays 689.8357.
6. Do step 4 of "Your project"; validate: no errors. Generate the XML.
