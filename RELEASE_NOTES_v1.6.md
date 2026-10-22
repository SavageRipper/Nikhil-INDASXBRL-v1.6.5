# INDAS XBRL Tool v1.6 — release notes

Base: v1.5.5. Details: README, section "v1.6".

## What changed

| # | Change | Effect for you |
|---|---|---|
| 1 | **Taxonomy:** the copy the MCA validator downloads (`Taxonomy-2017-03-31.zip`) replaces the package published on the MCA website. Compared file by file: two changes and one cosmetic change, 17 extra standard schema copies (unused), all other files identical | **SRN** of form ADT-1 and of the subsidiary's balance-sheet filing: both `A12345678` and the V3 format `AB1234567` are accepted. **Biological assets at cost:** the roll-forward (opening + changes = closing) is now checked and fills in the closing balance, as the MCA validator does; it could not be evaluated with the published taxonomy |
| 2 | **Download XML with errors** on the Generate XML page (shown while errors block generation) | After a confirmation you get the XML in spite of the errors, named `…_with-errors.xml`, with a "NOT VALIDATED" comment at the top — e.g. to have the MCA validator draw its PDF. Not for filing |
| 3 | **Shortcut keys** Alt+Shift+C (Copy from previous year), Alt+Shift+Y (switch previous / current year in a table), Alt+Shift+B (Back to note) | They press the page's own button, so they do exactly what a click does; where there is no such button a message says so. Also listed under menu → Keyboard shortcuts |
| 4 | **Drop-downs stay in place** | Choosing Yes/No or a list value no longer throws the table back to its top: the cell stays where it was on the screen and keeps the focus. Cause: the tab is re-drawn after such an answer and the table's own scroll frame was reset |

## Files

New: `Taxonomy-2017-03-31.zip`, `audit-v16.test.mjs`, `RELEASE_NOTES_v1.6.md`.

**Removed:** `Taxonomy_for_IND-AS_V1.2_31-03-2017.zip` (replaced by the validator's taxonomy). Delete it from the repository.

Changed: `taxonomy-source.mjs`, `compile.mjs`, `dts.mjs`, `rule-formalizer.mjs`, `gate.js`, `app.js`, `shell.html`,
`package.json`, `README.md`, `browser-smoke.mjs`, the tests `rules-source.test.mjs`, `rules.test.mjs`,
`rule-families.test.mjs`, `taxonomy.test.mjs` (they recorded the old taxonomy defect), and the generated
`MCA_AUTHORITY.json`, `BUSINESS_RULE_COVERAGE.json`, `RULE_AUDIT.json`, `index.html`, `indas-xbrl.html`, `artifact.html`,
`BUILD_INFO.json`.

No file was removed for size: you chose to keep all files.

## Your existing project files

Nothing to do: they open as before. A two-letter SRN you enter is accepted now. If a filing reports biological assets at
cost, validate it once: the roll-forward is now checked.

## Tests

| Suite | Result |
|---|---|
| Your two projects of this week (fair-value and subsidiaries) | the same errors and warnings as with v1.5.5 |
| Unit (`npm run test:unit`) | 282 / 282 (4 new in `audit-v16.test.mjs`) |
| Gate / Golden / Assurance | 11 / 11, 35 / 35, 37 / 37 |
| Browser (`browser-smoke.mjs`) | 182 / 182 (new: drop-down stays in place, Alt+Shift+C / Y / B, Download XML with errors on a filing with a known error) |
| Rule audit (`RULE_AUDIT.json`) | every rule as in v1.5.5, plus the biological-assets roll-forward: VERIFIED (was NOT_APPLICABLE) |
| Reference instances' XML | byte-identical to v1.5.5 (all four, directly and through the health check) |
| Clean unzip of the package (no golden files) | extracts the new taxonomy zip, recompiles the authority identically, builds the same `index.html`; unit 245 / 245 (9 golden-only skipped), gate 10 / 10 (1 golden-only skipped), browser 132 / 132 |

## Not run here

- The MCA validator: an XML with a two-letter SRN, and an XML "with errors" turned into its PDF.
- Shortcut keys on your keyboard layout (Alt+Shift switches the input language on some Windows set-ups if pressed alone).
- As before: `npm ci` with the pinned packages, the real XML parser, `xsd.test.mjs` / Arelle, the deployed site.

## Manual check (10 minutes)

1. The title reads **INDAS XBRL Tool v1.6**.
2. Auditor details table: enter SRN `AB1234567`, validate — no error on it; `ABC123456` — an error.
3. A long tab (e.g. 700300): scroll far down, choose Yes/No in a drop-down — the drop-down stays where it was.
4. Open a table (e.g. subsidiaries, current year): **Alt+Shift+Y** → previous year, again → current year; **Alt+Shift+B** →
   back to the note; on a tab with *Copy from previous year*, **Alt+Shift+C** copies (as the button).
5. With an error left (e.g. your subsidiaries project before the fix): Generate XML → **Download XML with errors** →
   confirm: file `…_with-errors.xml`; its second line says NOT VALIDATED.
6. Run that file through the MCA validator and convert it to PDF.
7. Fix the errors, generate normally: the usual file name, no NOT VALIDATED line.
