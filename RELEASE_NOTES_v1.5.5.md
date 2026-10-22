# INDAS XBRL Tool v1.5.5 — release notes

Base: v1.5.4. Replaces the subsidiaries part of v1.5.4. Reported: the MCA validator's "All mandatory elements for table
DisclosureOfDetailsOfSubsidiariesTable must be present for atleast one context as on 2026-03-31" on a next-year
consolidated filing. Details: README, section "v1.5.5".

## What changed

| | Before | v1.5.5 |
|---|---|---|
| Cause found | v1.5.4 looked at [611500] only | *Disclosure of details of subsidiaries [Table]* is one table name used by [611500] and [613400]. The MCA validator checks both mandatory lists together for at least one member. In the filing, [611500] used One / Two and [613400] Subsidiary1 / Subsidiary2, so no member carried both. The MCA-validated consolidated filing used "One" in both |
| Check | — | Where both tables have rows in a year, at least one member must carry both lists: an **error**, linked to the [613400] table. The same check for associates ([611400b] / [611500d]) and joint ventures ([611400] / [611500h]) is a **warning** until an MCA result confirms it |
| One-click fix | — | **Use the same members** on the error: renames the [613400] rows to the member the same subsidiary (matched by name) has in [611500]. Values are unchanged |
| New [613400] row | Subsidiary1, Subsidiary2 … | Suggests the [611500] members (One, Two …) |
| v1.5.4's eleven further [611500] elements and the reason-for-different-date warning | required / warning | **withdrawn** (MCA's workbook list again) |
| Count units (from v1.5.4) | | kept: a count keeps the unit the filing already uses for it |

## Files

New: `audit-v155.test.mjs`, `RELEASE_NOTES_v1.5.5.md`. Removed: `audit-v154.test.mjs` (its unit test moved to
`audit-v155.test.mjs`).

Changed (against v1.5.4): `rules.js`, `session.js`, `fixes.js`, `compile.mjs`, `rule-audit.mjs`,
`GOLDEN_CALIBRATION.json`, `app.js` and `browser-smoke.mjs` (back to v1.5.3), `shell.html`, `package.json`, `README.md`,
and the generated `MCA_AUTHORITY.json`, `BUSINESS_RULE_COVERAGE.json`, `RULE_AUDIT.json`, `index.html`,
`indas-xbrl.html`, `artifact.html`, `BUILD_INFO.json`.

## Your existing project files

1. Open the project and validate: one error on the subsidiaries table ("No member is used in both tables: [611500] One,
   Two · [613400] Subsidiary1, Subsidiary2").
2. Press **Use the same members** on the error and confirm (Subsidiary1 → One, Subsidiary2 → Two). Validate: no error.
3. If you entered the eleven extra [611500] values for v1.5.4, they may stay (harmless) or be removed.
4. Generate the XML and validate it with the MCA validator.

## Tests

| Suite | Result |
|---|---|
| Your project (opened with v1.5.5) | one error (no shared member); the fix renames Subsidiary1 → One and Subsidiary2 → Two; then no error; the XML has the same 7,036 facts, the [613400] facts now in the [611500] contexts (2 contexts fewer) |
| Unit (`npm run test:unit`) | 278 / 278 (9 in `audit-v155.test.mjs`) |
| Gate / Golden / Assurance | 11 / 11, 35 / 35, 37 / 37 |
| Browser (`browser-smoke.mjs`) | 176 / 176 |
| Rule audit (`RULE_AUDIT.json`) | every rule's result as in v1.5.3 |
| Reference instances' XML | byte-identical to v1.5.4 / v1.5.3 (all four, directly and through the health check); no new message on them |
| Clean unzip of the package (no golden files) | recompiles the authority identically, builds the same `index.html`; unit 241 / 241 (9 golden-only skipped), gate 10 / 10 (1 golden-only skipped), browser 127 / 127 |

## Not run here

- The MCA validator on the XML with the same members (the real check of this cause).
- As before: `npm ci` with the pinned packages, the real XML parser, `xsd.test.mjs` / Arelle, the deployed site.

## Manual check (10 minutes)

1. The title reads **INDAS XBRL Tool v1.5.5**.
2. Open your project, validate: one error on the subsidiaries table naming both tabs and their members.
3. Click the error: tab 613400 opens at the subsidiaries table.
4. Press **Use the same members**: the dialog lists Subsidiary1 → One and Subsidiary2 → Two, each with the
   subsidiary's name. Confirm.
5. Open the [613400] table: the rows are One and Two, with the same values. Validate: the error is gone.
6. In [611500], the eleven rows are no longer tagged "Mandatory · at least one row".
7. Generate the XML; validate it with the MCA validator.
