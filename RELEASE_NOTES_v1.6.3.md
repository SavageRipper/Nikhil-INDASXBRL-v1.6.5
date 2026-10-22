# INDAS XBRL Tool v1.6.3 — release notes

Base: v1.6.2. Details: README, section "v1.6.3".

## What changed

| # | Found | v1.6.3 |
|---|---|---|
| 1 | The C&I tool (same XML generator) had an XML accepted by the MCA XBRL Validator but refused by the AOC-4 XBRL form: *"Mismatch in financial year (to which financial statements relates) in Form and instance document"*. The Ind AS tool wrote its XML the same way: the **previous year first** (its contexts, and *Date of start / end of reporting period* 2024-04-01 before 2025-04-01 for a 2025-26 filing). All four MCA-filed reference XMLs list the current year first | The XML lists the **current year first**: current-year contexts, then previous year, then the opening date (transition date of a first Ind AS filing), then other dates; for each element the current-year value before the previous-year value. Only the order changes — every value is the same |

## Comparison with the four MCA-filed reference XMLs

Each was imported and generated again with v1.6.3, then compared with the filed file element by element.

| Item | Result |
|---|---|
| Schema reference, CIN and identifier scheme, periods, dimensions, units, footnotes | same |
| Values (every fact present in both) | same; no text value differs |
| General information read by the form (CIN, company name, start / end of reporting period, standalone / consolidated, board meeting date, rounding, PAN) | same, current year first as filed |
| Order | now as filed: current year first |
| Differences that remain (all accepted by the MCA XBRL Validator, on your filings too) | unit ids (`INR` instead of `Unit1`; one reference also uses `INR`); unused namespaces not declared; `xml:lang="en"` on text facts (Filing Manual #28; the references have none); 91.6 written for 91.60; line ends; fact ids only where a footnote needs one; answers made not applicable by a "No" are left out (dependency rules: 4 in one reference, 68 in each of two others — zeros and Nos under a "No") |

## Files

New: `audit-v163.test.mjs`, `RELEASE_NOTES_v1.6.3.md`.

Changed: `generator.js`, `browser-smoke.mjs`, `shell.html`, `package.json`, `README.md`, and the generated `index.html`,
`indas-xbrl.html`, `artifact.html`, `BUILD_INFO.json`.

## Your filings

Any Ind AS XML generated before v1.6.3 and not yet attached to AOC-4: open its project in v1.6.3, generate again, run
the MCA Validator, then attach. Checked on your four saved projects: the same facts, current year first.

## Tests

| Suite | Result |
|---|---|
| Unit (`npm run test:unit`) | 293 / 293 (2 new in `audit-v163.test.mjs`; they fail on v1.6.2) |
| Gate / Golden / Assurance | 11 / 11, 35 / 35, 37 / 37 |
| Browser (`browser-smoke.mjs`) | 187 / 187 (new: the XML in the app lists the current year first) |
| Rule audit (`RULE_AUDIT.json`) | identical to v1.6.2 |
| Reference instances' XML | same facts, contexts, units and footnotes as v1.6.2 (all four, directly and through the health check); only the order differs |
| Your four projects | same facts as v1.6.2; current year first |
| Clean unzip of the package (no golden files) | recompiles the authority identically, builds the same `index.html`; unit 254 / 254 (11 golden-only skipped), gate 10 / 10 (1 golden-only skipped), browser 137 / 137 |

## Not run here

- The AOC-4 XBRL upload, and the MCA Validator on a v1.6.3 XML.
- As before: `npm ci` with the pinned packages, the real XML parser, `xsd.test.mjs` / Arelle, the deployed site.

## Manual check (10 minutes)

1. The title reads **INDAS XBRL Tool v1.6.3** (Ctrl+F5 after uploading).
2. Open a project; Generate XML; the first comment shows the new build id.
3. In the XML, the first `<xbrli:context>` has the current year's dates (e.g. 2025-04-01 to 2026-03-31).
4. Search `DateOfStartOfReportingPeriod`: the current year's start date comes first.
5. Run the XML through the MCA Validator: no new message.
6. Attach it to AOC-4 XBRL: no "Mismatch in financial year" (the form's year and board meeting date as in the XML).
