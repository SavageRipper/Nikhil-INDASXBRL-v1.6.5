# INDAS XBRL Tool v1.6.2 — release notes

Base: v1.6.1. Details: README, section "v1.6.2".

## What changed

| # | Asked / reported | v1.6.2 |
|---|---|---|
| 1 | Footnotes in a rich-text box, with tables | The footnote editor (Alt+N on a cell, and the Footnotes page) is the text-block editor: paste tables from Word / Excel, lists, headings, Tidy. A footnote with plain lines only stays plain text; anything else is saved in the MCA HTML subset (MCA-validated filings carry footnotes with tables; the MCA PDF draws them). The Footnotes page shows each footnote as it prints, with *Edit text* and *New footnote…*. The preview PDF draws footnote tables |
| 2 | Merge / demerge cells | Not possible for MCA: its HTML has no merged cells (the validator rejects colspan / rowspan). Instead, a **Table…** list in the editor toolbar: insert row above / below, insert column left / right, delete row / column |
| 3 | A TOTAL column appearing in the shareholders table | Caused by two values stored without a shareholder ("NA" and 0, previous year). Now **Add row** with every axis at its default asks first; a **name or identifier** (name, PAN, CIN, country of incorporation, identification number of a shareholder, related party, structured entity, product) cannot be typed in a TOTAL column, and one already there is a warning with **Fix: Clear it**. Everything else stays open in TOTAL columns — share capital totals, PPE / intangibles totals, depreciation method, useful lives, revaluation answers, mode of valuation (all reported there in MCA-validated filings) |
| — | Deferred tax errors (612700) | No tool change: two previous-year figures were edited (opening deferred tax assets, tax on OCI). See "Your project" |

## Files

New: `audit-v162.test.mjs`, `RELEASE_NOTES_v1.6.2.md`.

Changed: `app.js`, `richtext.js`, `pdf-preview.js`, `views.js`, `session.js`, `gate.js`, `fixes.js`, `styles.css`,
`browser-smoke.mjs`, `shell.html`, `package.json`, `README.md`, and the generated `index.html`, `indas-xbrl.html`,
`artifact.html`, `BUILD_INFO.json`.

## Your project

1. Validation: the warning "Name of shareholder 'NA' is in the TOTAL column …" → **Fix: Clear it**. Then clear the 0 in
   *Number of shares held* of the same column (previous year). The TOTAL column disappears.
2. Deferred tax, previous year (table *Disclosure of temporary difference …*): *Deferred tax assets — at beginning of
   period* = **1,199.44** in all four columns (last year's filed figure); in the *Other temporary differences 1* column,
   *Aggregated income tax relating to components of OCI* = **6.83** (positive, as filed). The four roll-forward errors go.
3. The steps of v1.6.1 for the other errors (shareholder gaps, accuracy, nil values, related party E, PPE zeros).

## Tests

| Suite | Result |
|---|---|
| Your projects | the same errors as with v1.6.1; one new warning (the "NA" in the TOTAL column) with its fix. Deferred tax: steps of point 2 tried on a copy — the four errors go |
| Unit (`npm run test:unit`) | 291 / 291 (6 new in `audit-v162.test.mjs`) |
| Gate / Golden / Assurance | 11 / 11, 35 / 35, 37 / 37 |
| Browser (`browser-smoke.mjs`) | 186 / 186 (new: footnote editor, a pasted table in a footnote, table rows / columns, the TOTAL column question) |
| Rule audit (`RULE_AUDIT.json`) | identical to v1.6.1 |
| Reference instances' XML | byte-identical to v1.6.1 (all four, directly and through the health check); no new message on them |
| Clean unzip of the package (no golden files) | recompiles the authority identically, builds the same `index.html`; unit 253 / 253 (10 golden-only skipped), gate 10 / 10 (1 golden-only skipped), browser 136 / 136 |

## Not run here

- The MCA validator and its PDF on an XML with a footnote edited in the new editor (a footnote table).
- As before: `npm ci` with the pinned packages, the real XML parser, `xsd.test.mjs` / Arelle, the deployed site.

## Manual check (10 minutes)

1. The title reads **INDAS XBRL Tool v1.6.2**.
2. Footnotes page: each footnote is shown as it prints; your footnotes with tables show as tables.
3. *Edit text* on a footnote with a table: the table opens with its borders; **Table… → Insert row below**, type, Save.
4. *New footnote…*: paste a small table from Excel; Save; link it to a cell; Generate XML → Preview PDF shows it as a
   table under "Footnotes".
5. Shareholders table, previous year: the warning's **Fix: Clear it**, then clear the 0 — the TOTAL column goes.
6. In a table, choose the default (total) in every list of *Add row* → the tool asks before adding the TOTAL column.
7. Deferred tax corrections (point 2 of "Your project"); validate.
8. Generate the XML; run it through the MCA validator and look at a footnote table in its PDF.
