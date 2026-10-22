# INDAS XBRL Tool v1.6.4 — release notes

Base: v1.6.3. Ported from the C&I tool (v14.5 and v14.9), adapted to the Ind AS taxonomy and project file. Details:
README, section "v1.6.4". The generated XML does not change.

## What changed

| # | Asked | v1.6.4 |
|---|---|---|
| 1a | Auditor's report [700400]: a clause given under *Favourable* was still outlined as required under *Unfavourable* and *Clause not applicable* | Each clause is outlined only until it is given under one member of that year |
| 1b | One clause missing everywhere gave one ML-52 error per column | **One** ML-52 error per year, listing the missing clauses: *"… not present under any member for CY (each is required once, under one member)"*; it opens the column where most clauses are given. **This is the one change in the messages**; none of your four projects is affected |
| 1c | SR-L6448-1 (a clause under two members) did not open the table and had no fix | It opens the table at the clause; **Fix: Keep it under one member** — choose the member, the other column's text is removed |
| 2 | Workspace folder, automatic backups, version stamp | Menu **Workspace folder**: choose a folder once on each laptop (Chrome / Edge). **Save to workspace** puts the filing in `<Company> (<CIN>)/FY 2025-26/`, keeps the last 10 replaced versions in `backups`, and **Save XML to workspace** numbers the XML in `xml`. After the first save, **Ctrl+S** saves there too. Every save records the version number, date, time and this laptop's name. A newer version saved on the other laptop is shown, and a save over it asks first. **Save project** downloads as before (the file now carries the stamp) |
| 3 | Compare versions | Menu **Compare versions**: the open filing with a project or XML file, or two files. Lists changed settings, values (by year and column), text blocks and footnotes. The Workspace page compares any saved version, backup or XML with the open filing |
| — | Found while porting | **Open project** now saves the browser copy at once: before, a reload within half a second of opening could bring back the previous project |

## Using the workspace folder

- Use **Chrome or Edge**. Choose the folder with the folder picker (there is no path to type), inside **My Drive** of
  Google Drive for desktop, e.g. `G:\My Drive\XBRL`.
- Do not choose a Desktop or Documents folder that Google Drive backs up under *Computers*: those folders are not shared
  between laptops.
- On each laptop, enter the laptop's name once on the Workspace folder page; it is shown with every save.
- After Chrome is restarted it may ask once more for access: **Allow access again** on the Workspace folder page.
- The C&I tool can use the same folder: each tool lists only its own files (`.mca-indas.json` / `.mca-ci.json`).

## Files

New: `workspace.js`, `compare.js`, `audit-v164.test.mjs`, `workspace.test.mjs`, `RELEASE_NOTES_v1.6.4.md`.

Changed: `rules.js`, `fixes.js`, `app.js`, `shell.html`, `styles.css`, `browser-smoke.mjs`, `package.json`, `README.md`,
and the generated `index.html`, `indas-xbrl.html`, `artifact.html`, `BUILD_INFO.json`.

## Tests

| Suite | Result |
|---|---|
| Unit (`npm run test:unit`) | 308 / 308 (4 new in `audit-v164.test.mjs`, 11 in `workspace.test.mjs`) |
| Gate / Golden / Assurance | 11 / 11, 35 / 35, 37 / 37 |
| Browser (`browser-smoke.mjs`) | 205 / 205 (18 new: auditor's report outline and fix; workspace save, Ctrl+S, backups, XML, newer version on the other laptop, compare, reload, Save project; Open project then reload) |
| Rule audit (`RULE_AUDIT.json`) | identical to v1.6.3 |
| Reference instances' XML | byte-identical to v1.6.3 (all four, directly and through the health check); the same messages |
| Your four projects | the same errors and warnings as v1.6.3 |
| Clean unzip of the package (no golden files) | recompiles the authority identically, builds the same `index.html`; unit 269 / 269 (11 golden-only skipped), gate 10 / 10 (1 golden-only skipped), browser 155 / 155 |

## Not run here

- Google Drive syncing between two real laptops, and Chrome's own folder picker (the tests use the browser's built-in
  test folder through the same folder functions).
- As before: `npm ci` with the pinned packages, the real XML parser, `xsd.test.mjs` / Arelle, the MCA Validator, the
  deployed site.

## Manual check (15 minutes)

1. The title reads **INDAS XBRL Tool v1.6.4** (Ctrl+F5 after uploading).
2. Auditor's report [700400]: give a clause under *Favourable* only — the other columns no longer outline it.
3. Give the same clause also under *Unfavourable*; validate: SR-L6448-1 opens the table; **Fix: Keep it under one
   member** → choose *Unfavourable* → the clause stays only there.
4. Menu **Workspace folder** → enter this laptop's name → **Choose workspace folder…** → a folder in My Drive.
5. Open your project → **Save to workspace**: the list shows it, version 1; the bar shows *Workspace · v1*.
6. Change a value → the bar shows *Workspace: not saved* → **Ctrl+S** → version 2; *Backups* shows 1.
7. Generate XML → **Save XML to workspace** → the folder `xml` has the XML numbered v1.
8. On the second laptop (after Drive has synced): same folder, open the filing from the list, change something, save
   (version 3).
9. Back on the first laptop: **Refresh list** → *Newer version in workspace* → **Compare first** shows the change →
   **Open the newer version**.
10. **Compare versions** → *Compare the open filing with a file…* → choose an older XML: the differences are listed.
11. **Save project** still downloads the project file.
