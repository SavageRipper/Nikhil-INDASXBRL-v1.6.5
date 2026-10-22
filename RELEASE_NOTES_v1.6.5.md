# INDAS XBRL Tool v1.6.5 — release notes

Base: v1.6.4. Ported from the C&I tool v15.3. Details: README, section "v1.6.5". The XML, the validation messages and
the figures do not change.

## What changed

| # | Before | v1.6.5 |
|---|---|---|
| 1 | An imported XML kept its **file name** as the filing's stored name, so the workspace folder and the project file were named like `123456789_XBRL_Standalone (1)` (the company page still showed the right company). All four of your saved projects are named this way | **Import XML** names the filing after the *Name of company* in the XML |
| 2 | Projects already saved under a file name | On opening, the health check renames the filing after its *Name of company* and says so. The XML is unchanged |
| 3 | A corrected company name kept the old workspace folder | The next save **moves** the filing to the folder of its new name, with its backups and XML files; the old folder is removed once empty. The other report type's files in the same folder stay |
| 4 | A failed save said only "A requested file or directory could not be found…" | The message names the **folder or file** that failed, the save is tried once more after a moment, and it says what to check |
| 5 | Long company names made long paths | Folder names use at most 60 characters of the company name and file names 40, cut at a word, well inside the Windows limit of 260 characters for a whole path |
| 6 | The CIN ran into the company name in the workspace list | The CIN is on its own line |
| — | Found while testing | The *Newer version in workspace* notice could disappear for a moment when the Workspace page and *Refresh list* checked the folder at the same time; the check now sets its result once. The example filing's stored name is its *Name of company* |

## Your workspace after deploying

On the **Workspace folder** page, open each filing saved under a file name and press **Ctrl+S**. It moves into a folder
named `<Company name> (<CIN>)`, with its backups and XML. If a save fails, the message now names the folder; send it to
me if it is not clear.

## Files

New: `audit-v165.test.mjs`, `RELEASE_NOTES_v1.6.5.md`.

Changed: `importer.js`, `upkeep.js`, `workspace.js`, `app.js`, `styles.css`, `example.js`, `workspace.test.mjs`,
`browser-smoke.mjs`, `package.json`, `shell.html`, `README.md`, and the generated `index.html`, `indas-xbrl.html`,
`artifact.html`, `BUILD_INFO.json`.

## Tests

| Suite | Result |
|---|---|
| Unit (`npm run test:unit`) | 313 / 313 (5 new in `audit-v165.test.mjs`) |
| Gate / Golden / Assurance | 11 / 11, 35 / 35, 37 / 37 |
| Browser (`browser-smoke.mjs`) | 207 / 207, three runs (new: a corrected name moves the filing; an XML imported under an odd file name is named and saved after the company) |
| Rule audit (`RULE_AUDIT.json`) | identical to v1.6.4 |
| Reference instances' XML | byte-identical to v1.6.4 (all four, directly and through the health check); the same messages; the imported names are the companies' names |
| Your four projects | the same errors, warnings and XML as v1.6.4; each is renamed once on opening, to its *Name of company* |
| Clean unzip of the package (no golden files) | recompiles the authority identically, builds the same `index.html`; unit 274 / 274 (11 golden-only skipped), gate 10 / 10 (1 golden-only skipped), browser 157 / 157 |

## Not run here

- Google Drive syncing between two real laptops, Chrome's own folder picker, and a real "not found" error from Drive
  (the tests simulate it on the same folder functions).
- As before: `npm ci` with the pinned packages, the real XML parser, `xsd.test.mjs` / Arelle, the MCA Validator, the
  deployed site.

## Manual check (10 minutes)

1. The title reads **INDAS XBRL Tool v1.6.5** (Ctrl+F5 after uploading).
2. Open a project saved under a file name: the message says it is now named after the company; the bar shows the
   company name.
3. **Workspace folder** → press **Ctrl+S** (or *Save to workspace*): the message says it moved from the old folder.
4. The list shows the company with its CIN on the line below; the old folder is gone in File Explorer / Drive.
5. **Import XML** of an XML with a long file name (*Both years*) → the bar shows the company name → *Save to workspace*
   → the folder is `<Company name> (<CIN>)`.
6. Generate XML → *Save XML to workspace*: saved in that folder's `xml`.
7. Validate: the same messages as before.
