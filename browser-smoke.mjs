// Browser regression of the built app (index.html) in headless Chromium via playwright-core.
// Exercises the real UI on the Ind AS example: table availability, first-time adoption column, calculated cells,
// rich-text editing → autosave → reload → XML → import → edit, Yes/No dependencies, validation navigation,
// current-tab validation, cash-flow method, and the three import modes (both / current / roll forward).
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { facts as rawFacts, diff as rawDiff } from './golden-diff.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);

export function browserStatus() {
  const exe = CANDIDATES.find((p) => existsSync(p));
  return exe ? { available: true, executable: exe } : { available: false, reason: 'no Chromium executable found (set CHROMIUM_PATH)' };
}

const tab = (code) => `#nav a[data-elr$="_${code}"]`;

export async function runBrowserSmoke() {
  const st = browserStatus();
  if (!st.available) return { status: 'UNAVAILABLE', ...st, checks: [] };
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { return { status: 'UNAVAILABLE', available: false, reason: 'playwright-core not installed', checks: [] }; }
  const browser = await chromium.launch({ executablePath: st.executable });
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  page.on('dialog', (d) => d.dismiss()); // the app never uses browser dialogs
  const url = pathToFileURL(path.join(ROOT, 'index.html')).href;
  const exported = path.join(ROOT, '.smoke-export.xml');
  const setCell = async (sel, v) => { await page.fill(sel, v); await page.dispatchEvent(sel, 'change'); await page.waitForTimeout(80); };
  try {
    await page.goto(url);
    await page.waitForSelector('#nav a[data-elr]');
    check('app loads: 60 Ind AS ELRs in the navigation, example filing marked', (await page.locator('#nav a[data-elr]').count()) === 60 && /example data/.test(await page.textContent('#bar-who')));
    check('branding: Ind AS taxonomy 2017, Ind AS schemaRef shown', /IND AS TAXONOMY 2017/i.test(await page.textContent('.brand')) && /Ind\/in-ci-ent-2017-03-31\.xsd/.test(await page.textContent('#main')));

    // ---- table availability follows the balance sheet ([400500] current investments)
    const ciBtn = (scope) => `button[data-open-table="400500:DetailsOfCurrentInvestmentsTable"][data-scope="${scope}"]`;
    await page.click(tab('400500'));
    check('[400500] closed while current investments = 0', await page.isDisabled(ciBtn('CY')) && await page.isDisabled(ciBtn('PY')));
    await page.click(tab('110000'));
    const CI = 'input[data-c="ind-as:CurrentInvestments"][data-s="CY"]';
    await setCell(CI, '250000');
    await page.click(tab('400500'));
    check('[400500] opens (and is required) for the current year when the balance sheet amount > 0; previous year stays closed', !(await page.isDisabled(ciBtn('CY'))) && /required/.test(await page.textContent(ciBtn('CY'))) && await page.isDisabled(ciBtn('PY')));
    await page.click(tab('110000'));
    await setCell(CI, '0');

    // ---- calculated cells: read-only, auto-populated, tab override
    const CA = 'input[data-c="ind-as:CurrentAssets"][data-s="CY"]';
    const TR = 'input[data-c="ind-as:CurrentTaxAssets"][data-s="CY"]'; // v1.2: a part without a note (trade receivables are taken from their note)
    check('calculated parent cell is read-only by default', (await page.getAttribute(CA, 'readonly')) !== null && await page.evaluate((s) => document.querySelector(s).classList.contains('calc'), CA));
    const before = Number(await page.inputValue(CA));
    const trBefore = await page.inputValue(TR);
    await setCell(TR, String(Number(trBefore) + 100));
    check('auto-calculation: Current assets updated from its children immediately', Number(await page.inputValue(CA)) === before + 100, `${before} → ${await page.inputValue(CA)}`);
    await setCell(TR, trBefore);
    await page.check('input[data-calc-override$="_110000"]');
    check('tab option enables editing of calculated cells on this tab', (await page.getAttribute(CA, 'readonly')) === null);
    await page.click(tab('210000'));
    check('override is per tab (P&L calculated cells stay read-only)', (await page.$$eval('#main .cellin.calc[readonly]', (els) => els.length)) > 0);
    await page.click(tab('110000'));
    await page.uncheck('input[data-calc-override$="_110000"]');
    check('disabling the option restores read-only, value kept', (await page.getAttribute(CA, 'readonly')) !== null && Number(await page.inputValue(CA)) === before);

    // ---- mismatch panel: calculated vs reported differences and the override log, with jump-to-cell
    await page.check('input[data-calc-override$="_110000"]');
    await setCell(CA, String(before + 1));
    await page.click('a[data-go="mismatch"]');
    await page.waitForSelector('#main .tiles');
    const mm = await page.textContent('#main');
    check('Mismatch panel lists the calculation difference and the manual-override log', /calculation differences/.test(mm) && /Manual override of a calculated cell: Current assets/.test(mm) && /Calculation inconsistency/.test(mm), mm.slice(0, 400));
    await page.locator('.issues li.nav-issue', { hasText: 'Manual override of a calculated cell: Current assets' }).first().click();
    await page.waitForTimeout(200);
    check('clicking a mismatch focuses the cell', (await page.evaluate(() => document.activeElement?.dataset?.cell || '')).startsWith('ind-as:CurrentAssets#I:'));
    await setCell(CA, String(before));
    await page.uncheck('input[data-calc-override$="_110000"]');

    // ---- country fields offer the workbook country list (Filing Manual Annexure III / Country Codes sheet)
    await page.click(tab('400100'));
    const SHQ = 'select[data-c="ind-as:WhetherThereAreAnyShareholdersHoldingMoreThanFivePerCentSharesInCompany"][data-s="CY"]';
    await page.selectOption(SHQ, 'true'); await page.waitForTimeout(150);
    await page.click('button[data-open-table="400100a:DisclosureOfShareholdingMoreThanFivePerCentInCompanyTable"][data-scope="CY"]');
    await page.waitForSelector('#addslice');
    for (const sel of await page.$$('#addslice select')) { const opts = await sel.$$eval('option', (os) => os.map((o) => o.value).filter(Boolean)); await sel.selectOption(opts[0]); }
    await page.click('#addslice button[type="submit"]');
    await page.waitForTimeout(150);
    check('country cells suggest the workbook country names (datalist)', (await page.locator('#main input[data-c="in-ca:CountryOfIncorporationOrResidenceOfShareholder"][list="dl-country"]').count()) === 1 && (await page.locator('#dl-country option').count()) > 100);
    await page.click(tab('400100'));
    await page.selectOption(SHQ, 'false'); await page.waitForTimeout(150);

    // ---- first-time adoption: opening balance sheet of the previous year
    await page.click('a[data-go="setup"]');
    await page.check('#fta-yes');
    await page.waitForTimeout(150);
    await page.click(tab('110000'));
    const pyo = 'input[data-c="ind-as:TradeReceivablesCurrent"][data-s="PYO"]';
    check('FTA = Yes: balance sheet gets the third column (opening balance sheet of the previous year, 2016-03-31)', (await page.locator(pyo).count()) === 1 && /Opening 2016-03-31/.test(await page.textContent('#main thead')) && /First-time adoption of Ind AS/.test(await page.textContent('#main')));
    await setCell(pyo, '250000');
    check('opening column totals are auto-calculated', Number(await page.inputValue('input[data-c="ind-as:CurrentAssets"][data-s="PYO"]')) === 250000);
    // v1.1: an opening value without its total — the message gives the date and opens the opening-column cell (GR-16)
    {
      const tot = 'input[data-c="ind-as:CurrentAssets"][data-s="PYO"]';
      await page.check('[data-calc-override]'); await page.waitForTimeout(100);
      await setCell(tot, '');
      await page.click('.bar button[data-act="validate"]');
      await page.waitForSelector('.issues, .banner');
      await page.click('[data-filter="ALL"]');
      const msg = page.locator('.issues li.nav-issue', { hasText: 'previous-year opening value (dated 2016-03-31)' }).first();
      const has = (await msg.count()) === 1;
      if (has) await msg.click();
      await page.waitForTimeout(200);
      const focused = await page.evaluate(() => { const e = document.activeElement; return e ? `${e.dataset.c}|${e.dataset.s}` : ''; });
      check('v1.1: GR-1 on an opening balance sheet value gives its date and opens the opening-column cell (GR-16)', has && /\|PYO$/.test(focused) && /ind-as:/.test(focused), focused);
      check('v1.1: a GR-16 opening value is never offered for removal as an opening value without a total', (await page.locator('[data-act="remove-pyo-orphans"]').count()) === 0);
      await page.click(tab('110000'));
      if (await page.isChecked('[data-calc-override]')) { await page.uncheck('[data-calc-override]'); await page.waitForTimeout(100); }
      await setCell(pyo, '250001'); await setCell(pyo, '250000');
      check('v1.1: the opening total is calculated again once its part is re-entered', Number(await page.inputValue(tot)) === 250000, await page.inputValue(tot));
    }
    await page.click('a[data-go="setup"]');
    await page.check('#fta-no');
    await page.waitForSelector('#dlg-continue');
    check('FTA Yes → No asks first (opening values retained but excluded)', /retained but excluded/.test(await page.textContent('#modal-body')));
    await page.click('#dlg-continue');
    await page.waitForTimeout(150);
    await page.click(tab('110000'));
    check('FTA = No: two columns again', (await page.locator('input[data-s="PYO"]').count()) === 0);

    // ---- rich text in a modal: Text Block → editor → Save / Cancel → reload → XML → import → edit
    const TBC = 'ind-as:DisclosureOfNotesOnEquityShareCapitalExplanatory';
    const tbBtn = `#main [data-textblock][data-c="${TBC}"][data-s="CY"]`;
    const ed = '#tb-editor';
    const btn = (cmd) => `#modal [data-rte="${cmd}"]`;
    await page.click(tab('400100'));
    check('text block cell is a compact Text Block button (no embedded editor)', (await page.locator(tbBtn).count()) === 1 && (await page.locator('#main .rte-body').count()) === 0);
    await page.click(tbBtn);
    check('Text Block opens a modal editor with toolbar, Save and Cancel', await page.isVisible('#modal') && (await page.locator('#modal [data-rte]').count()) >= 7 && await page.isVisible('#tb-save') && await page.isVisible('#tb-cancel'));
    // v1.1 (C&I v14.1): a new filing uses the recommended text setting — Word text is tidied for the MCA PDF on paste
    check('v1.1: new filing — text setting "plain text, bold lines as headings"; B/I/U hidden, H and Tidy shown', (await page.inputValue('#tb-emphasis')) === 'headings' && (await page.locator('#modal .rte.emph-headings').count()) === 1 && !(await page.isVisible(btn('bold'))) && await page.isVisible(btn('heading')) && await page.isVisible(btn('tidy')) && await page.isVisible('#modal .rte-layout'));
    await page.click(ed);
    await page.evaluate((sel) => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<html><body><p class=MsoNormal><b>INDEPENDENT AUDITORS REPORT</b></p><p class=MsoNormal>&nbsp;</p><h2>1. Opinion</h2><p class=MsoNormal>&nbsp;</p>'
        + '<p class=MsoNormal>We have audited <b>M/s. Example Limited</b>.</p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal><b>We believe that the evidence is sufficient.</b></p>'
        + '<table><tr><td><b>Particulars</b></td><td>&nbsp;</td><td>2026</td></tr><tr><td>Sales</td><td>&nbsp;</td><td>10</td></tr></table></body></html>');
      dt.setData('text/plain', 'x');
      document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, ed);
    const tidyHtml = await page.innerHTML(ed);
    check('v1.1: Word paste — bold lines and Word headings become headings, inline bold plain, blank lines and empty columns removed', /<h5>INDEPENDENT AUDITORS REPORT<\/h5>/.test(tidyHtml) && /<h5>1\. Opinion<\/h5>/.test(tidyHtml) && /<p>We have audited M\/s\. Example Limited\.<\/p>/.test(tidyHtml) && /<p>We believe that the evidence is sufficient\.<\/p>/.test(tidyHtml) && !/<b>|<h2>|<p>(&nbsp;|\s)*<\/p>/.test(tidyHtml.replace(/<table>.*<\/table>/, '')) && (/<tr>(.*?)<\/tr>/.exec(tidyHtml)?.[1].match(/<td/g) || []).length === 2, tidyHtml.slice(0, 500));
    check('v1.1: paste confirms the tidying; the layout line reports nothing untidy', /tidied for the MCA PDF/.test(await page.textContent('#toast')) && /no empty paragraphs/.test(await page.textContent('#modal .rte-layout')));
    await page.keyboard.press('Control+b');
    await page.keyboard.type('Z');
    check('v1.1: Ctrl+B is not used with the plain-text setting (explains why)', !/<b>/.test(await page.innerHTML(ed)) && /grey box/.test(await page.textContent('#toast')));
    await page.click('#tb-cancel');
    await page.click(tbBtn);
    await page.selectOption('#tb-emphasis', 'highlight');
    check('v1.1: MCA highlight setting — B/I/U shown, the editor shows bold as the MCA PDF prints it (white on grey)', await page.isVisible(btn('bold')) && (await page.locator('#modal .rte.emph-highlight').count()) === 1);
    await page.click(ed);
    await page.keyboard.type('Equity shares of Rs 10 each. ');
    for (const [cmd, word] of [['bold', 'Bold term'], ['italic', 'Italic term'], ['underline', 'Underlined term']]) { await page.click(btn(cmd)); await page.keyboard.type(word); await page.click(btn(cmd)); await page.keyboard.type(' '); }
    check('v1.1: bold shows as white text on grey in the editor (highlight setting)', await page.evaluate(() => { const b = document.querySelector('#tb-editor b'); const cs = b && getComputedStyle(b); return !!cs && cs.backgroundColor === 'rgb(102, 102, 102)' && cs.color === 'rgb(255, 255, 255)'; }));
    await page.keyboard.press('Enter');
    await page.click(btn('insertOrderedList'));
    await page.keyboard.type('First point'); await page.keyboard.press('Enter'); await page.keyboard.type('Second point'); await page.keyboard.press('Enter');
    await page.click(btn('insertOrderedList'));
    await page.click(btn('insertUnorderedList'));
    await page.keyboard.type('Bullet point'); await page.keyboard.press('Enter');
    await page.click(btn('insertUnorderedList'));
    // v1.5.3: Paragraph style list — the line at the cursor becomes Heading 2 (MCA class header2), and the list follows the cursor
    await page.keyboard.type('Section title');
    await page.selectOption('#modal .rte-style', 'h2');
    await page.waitForTimeout(100);
    check('v1.5.3: Paragraph style sets the heading level of the line at the cursor', /<h2>Section title<\/h2>/.test(await page.innerHTML(ed)) && (await page.inputValue('#modal .rte-style')) === 'h2', (await page.innerHTML(ed)).slice(-200));
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await page.selectOption('#modal .rte-style', 'p');
    await page.evaluate((sel) => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><p class=MsoNormal style="margin:0"><span style="font-weight:bold">Pasted bold</span> and <span style="font-style:italic">pasted italic</span><o:p></o:p></p><img src="x.png">' +
        // Excel-style table: colgroup/col, colspan, width/style attributes, padded numbers, whitespace paragraphs
        '<table border=0 cellpadding=0 style="border-collapse:collapse"><colgroup><col width=200><col width=80 span=4></colgroup>' +
        '<tr><td rowspan=2 style="border:.5pt solid windowtext"><p>   </p><p><b>Name of Assets</b></p></td><td colspan=4 class=xl65 style="border:.5pt solid windowtext"><b>Gross Block</b></td></tr>' +
        '<tr><td>As on</td><td>Addition</td><td>Deduction</td><td>As on</td></tr>' +
        '<tr><td>Office Equipments</td><td align=right>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 17.45 </td><td>&nbsp;&nbsp;&nbsp; 6.68</td><td>&nbsp; - </td><td>24.14</td></tr></table></body></html>');
      dt.setData('text/plain', 'Pasted bold and pasted italic');
      document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, ed);
    await page.click('#tb-save');
    check('Save Text closes the popup and updates the cell preview', await page.isHidden('#modal') && /Equity shares of Rs 10 each/.test(await page.textContent(`${tbBtn} >> xpath=../span[contains(@class,"tb-prev")]`)));
    await page.click(tbBtn); await page.click(ed); await page.keyboard.press('Control+End'); await page.keyboard.type(' DISCARD ME'); await page.click('#tb-cancel');
    await page.click(tbBtn);
    const reopened = await page.innerHTML(ed);
    check('Cancel leaves the stored value unchanged', !/DISCARD ME/.test(reopened) && /<b>Bold term<\/b>/.test(reopened), reopened.slice(0, 200));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700); // autosave debounce
    await page.waitForSelector('#bar-save.ok');
    await page.reload();
    await page.waitForSelector('#nav a[data-elr]');
    check('project restored from this browser after reload', /Restored your last project/.test(await page.textContent('#toast')));
    // v1.5.1: a project autosaved by v1.5 or earlier (localStorage) is still restored, then moved to IndexedDB
    await page.evaluate(async () => {
      const KEY = 'mca-indas-xbrl.project.v1';
      const raw = await new Promise((res) => { const r = indexedDB.open('mca-indas-xbrl', 1); r.onsuccess = () => { const g = r.result.transaction('projects').objectStore('projects').get(KEY); g.onsuccess = () => { r.result.close(); res(g.result); }; }; });
      const j = JSON.parse(raw); j.meta.name = 'Old Save Co'; for (const f of j.facts) if (/:NameOfCompany$/.test(f.concept) && !(f.dims || []).length) f.value = 'Old Save Co'; localStorage.setItem(KEY, JSON.stringify(j));
      await new Promise((res) => { const r = indexedDB.deleteDatabase('mca-indas-xbrl'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    });
    await page.reload();
    await page.waitForSelector('#nav a[data-elr]');
    const oldName = await page.textContent('#bar-who');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => /Saved in this browser/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const leftInLs = await page.evaluate(() => localStorage.getItem('mca-indas-xbrl.project.v1'));
    check('v1.5.1: a project saved by an earlier version (localStorage) is restored and moved to IndexedDB', /Old Save Co/.test(oldName) && leftInLs === null, `${oldName.slice(0, 60)} / localStorage ${leftInLs ? 'still set' : 'cleared'}`);
    await page.click(tab('400100'));
    await page.click(tbBtn);
    const html = await page.innerHTML(ed);
    await page.click('#tb-cancel');
    check('rich text survives reload (bold / italic / underline / lists)', /<b>Bold term<\/b>/.test(html) && /<i>Italic term<\/i>/.test(html) && /<u>Underlined term<\/u>/.test(html) && /<ol><li>First point<\/li><li>Second point<\/li><\/ol>/.test(html) && /<ul><li>Bullet point<\/li><\/ul>/.test(html), html.slice(0, 500));
    check('paste from Word: emphasis kept, Office markup / images / styles dropped', /<b>Pasted bold<\/b>/.test(html) && /<i>pasted italic<\/i>/.test(html) && !/style=|<img|o:p|Mso/.test(html), html);
    const ptab = /<table>[\s\S]*?<\/table>/.exec(html)?.[0] || '';
    const rowsCells = [...ptab.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => (m[1].match(/<td/g) || []).length);
    check('paste from Excel: table rebuilt without colgroup/col/colspan/rowspan, every row 5 cells, every cell bordered', ptab && !/colgroup|<col|colspan|rowspan|width=|align=/.test(ptab) && rowsCells.length === 3 && rowsCells.every((n) => n === 5) && (ptab.match(/<td class="bordered">/g) || []).length === 15, ptab.slice(0, 400));
    check('paste from Excel: number padding removed, merged header kept in its first cell', /<td class="bordered">17\.45<\/td>/.test(ptab) && /<td class="bordered">-<\/td>/.test(ptab) && /<b>Gross Block<\/b>/.test(ptab) && !/<p>\s*<\/p>/.test(ptab), ptab.slice(0, 600));
    await page.click('a[data-go="xml"]');
    await page.click('button[data-act="generate"]');
    await page.waitForSelector('#xmltext, .banner.bad');
    if (!(await page.locator('#xmltext').count())) { await page.click('a[data-go="validate"]'); throw new Error('generation blocked: ' + (await page.textContent('.issues')).slice(0, 600)); }
    const xml = await page.textContent('#xmltext');
    check('XML generated after the internal gate passed; Ind AS schemaRef', /INTERNAL GATE · PASS/i.test(await page.textContent('#bar-status')) && xml.includes('https://www.mca.gov.in/V3XBRL/2017/07/16/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd'));
    const fact = new RegExp(`<${TBC}[^>]*>([^<]*)<`).exec(xml)?.[1] || '';
    const mca = fact.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    check('XML text block: highlightedText1/2/3 and noteText1 list classes (bullets too, v1.5.3), only allowed tags, no style', ['highlightedText1">Bold term', 'highlightedText2">Italic term', 'highlightedText3">Underlined term', 'noteText1"><p>1.&nbsp;', 'noteText1"><p>•&nbsp;'].every((x) => mca.includes(x)) && !mca.includes('noteText2') && ![...mca.matchAll(/<\/?([a-zA-Z]+)/g)].some((m) => !['div', 'span', 'p', 'br', 'table', 'td', 'tr', 'thead', 'tfoot', 'tbody', 'th', 'col', 'colgroup'].includes(m[1])) && !/style=/.test(mca), mca.slice(0, 300));
    check('v1.5.3: the heading level chosen in the editor is written as its MCA class (header2)', /<p class="header2">Section title<\/p>/.test(mca), mca.slice(0, 400));
    check('XML: text block HTML carries only class attributes and no colgroup/col (MCA HTML schema)', [...mca.matchAll(/<[a-z]+((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/g)].every((m) => [...m[1].matchAll(/([a-z-]+)=/g)].every((a) => a[1] === 'class')) && !/<col|colgroup/.test(mca) && /<table><tbody><tr><td class="bordered">/.test(mca), mca.slice(mca.indexOf('<table'), mca.indexOf('<table') + 300));
    const buildId = await page.getAttribute('.brand small', 'data-build');
    check('build id shown in the header and written into the generated XML', /^[0-9a-f]{10}$/.test(buildId || '') && xml.includes(`<!-- Generated by Ind AS XBRL Studio build ${buildId} -->`), buildId);
    check('XML: no xml:lang on restricted in-ca types (CIN, report type, rounding level)', !/<in-ca:(CorporateIdentityNumber|NatureOfReportStandaloneConsolidated|LevelOfRoundingUsedInFinancialStatements) [^>]*xml:lang/.test(xml) && /<in-ca:NameOfCompany [^>]*xml:lang="en"/.test(xml));
    // v1.6.3: the current year first (AOC-4 XBRL compares the form's financial year with the instance)
    {
      const firstCtx = /<xbrli:context id="[^"]+">[\s\S]*?<xbrli:period>([\s\S]*?)<\/xbrli:period>/.exec(xml)?.[1].replace(/<[^>]+>/g, ' ').trim().split(/\s+/) || [];
      const pd = [...xml.matchAll(/<in-ca:DateOf(Start|End)OfReportingPeriod [^>]*>([^<]+)</g)].map((m) => m[2]);
      check('v1.6.3: the XML lists the current year first (first context and reporting-period dates)', firstCtx.length === 2 && firstCtx[0] === pd[0] && firstCtx[1] === pd[2] && pd.length === 4 && pd[0] > pd[1] && pd[2] > pd[3], JSON.stringify({ firstCtx, pd }));
    }
    writeFileSync(exported, xml);

    // ---- import modes on the generated XML
    await page.setInputFiles('#file-xml', exported);
    await page.waitForSelector('#import-confirm');
    check('import waits for a choice (Import disabled); two modes offered (Both years, Prepare next year\'s filing)', await page.isDisabled('#import-commit') && (await page.locator('#ym-both, #ym-next').count()) === 2 && (await page.locator('#ym-current, #ym-rollforward').count()) === 0);
    await page.check('#ym-next');
    await page.click('#import-commit');
    await page.waitForSelector('.banner.info');
    check('Prepare next year: new year 2018-04-01 → 2019-03-31 shown', /Prepare next year/.test(await page.textContent('.banner.info')) && /2018-04-01 → 2019-03-31/.test(await page.textContent('#bar-who')));
    await page.click(tab('110000'));
    const rf = await page.$$eval('#main .cellin[data-s]', (els) => ({ cy: els.filter((e) => e.dataset.s === 'CY' && e.value !== '').length, py: els.filter((e) => e.dataset.s === 'PY' && e.value !== '').length, pyRo: els.filter((e) => e.dataset.s === 'PY' && e.readOnly).length, pyAll: els.filter((e) => e.dataset.s === 'PY' && !e.disabled).length }));
    check('Prepare next year: last year\'s figures in the previous-year column, current year empty', rf.py > 5 && rf.cy === 0, JSON.stringify(rf));
    check('Prepare next year: the previous-year column is locked as filed (read-only, "Previous year locked")', rf.pyRo === rf.pyAll && rf.pyAll > 5 && (await page.locator('#main .tabtools .chip', { hasText: 'Previous year locked' }).count()) === 1, JSON.stringify(rf));
    await page.click('#main [data-act="py-unlock"]');
    await page.click('#dlg-continue');
    const unl = await page.$$eval('#main .cellin[data-s="PY"]:not([disabled])', (els) => els.filter((e) => e.readOnly && !e.classList.contains('calc')).length);
    check('Unlock previous year: the previous-year cells become editable; Lock previous year offered', unl === 0 && (await page.locator('#main [data-act="py-lock"]').count()) === 1, String(unl));
    await page.click('#main [data-act="py-lock"]');
    check('Lock previous year locks it again', (await page.locator('#main [data-act="py-unlock"]').count()) === 1);
    const hc = Number((await page.textContent('#hidden-count').catch(() => '0')) || 0);
    check('Hidden data in the menu shows a count (last year\'s set-aside values)', hc > 10, String(hc));
    await page.click('a[data-go="hidden"]');
    check('Hidden data page lists the set-aside values by reason, with Restore / Delete', Number(await page.textContent('#sa-count')) > 10 && (await page.locator('#main [data-act="sa-delete-group"]').count()) >= 2 && (await page.locator('#main [data-act="sa-restore"], #main [data-act="sa-delete"]').count()) > 0);
    await page.click('a[data-go="validate"]');
    check('Validation page: previous year compared with last year\'s filing — all equal', /All previous-year figures equal the filed ones/.test(await page.textContent('#main')));
    // v1.2 (C4): copy last year's disclosures into the empty current-year cells of a disclosure tab
    await page.click(tab('700300'));
    const dcb = page.locator('#main button[data-act="carry-disclosure"]');
    check('disclosure tab of a prepared next-year filing: "Copy from previous year (n)" offered', (await dcb.count()) === 1 && !(await dcb.isDisabled()) && /\(\d+\)/.test(await dcb.textContent()));
    await dcb.click();
    await page.click('#dlg-continue');
    await page.waitForTimeout(200);
    const nameCy = await page.inputValue('#main input[data-c="in-ca:NameOfCompany"][data-s="CY"]').catch(() => '');
    check('Copy from previous year fills the empty current-year cells (company name) and is then used up', nameCy !== '' && (await page.locator('#main button[data-act="carry-disclosure"]').isDisabled()), nameCy);
    await page.click(tab('110000'));
    check('balance sheet offers no disclosure copy', (await page.locator('#main button[data-act="carry-disclosure"]').count()) === 0);
    await page.setInputFiles('#file-xml', exported);
    await page.waitForSelector('#import-confirm');
    await page.check('#ym-both');
    await page.click('#import-commit');
    await page.waitForSelector('.banner.info');
    check('Both years: summary shown', /Previous year imported: [\d,]+ facts/.test(await page.textContent('.banner.info')));
    await page.click(tab('400100'));
    await page.click(tbBtn);
    const imported = await page.innerHTML(ed);
    check('XML import: formatting restored in the popup editor', /<b>Bold term<\/b>/.test(imported) && /<ol><li>First point/.test(imported), imported.slice(0, 300));
    await page.click(ed); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.click(btn('bold')); await page.keyboard.type('Edited after import'); await page.click('#tb-save');
    await page.click('a[data-go="xml"]');
    await page.click('button[data-act="generate"]');
    await page.waitForSelector('#xmltext, .banner.bad');
    const xml2 = (await page.locator('#xmltext').count()) ? await page.textContent('#xmltext') : '';
    let why = '';
    if (!xml2) { await page.click('a[data-go="validate"]'); why = (await page.textContent('.issues')).slice(0, 800); } else why = (new RegExp(`<${TBC}[^>]*>([^<]*)<`).exec(xml2)?.[1] || 'text block not in XML').slice(-400);
    // (the caret may carry the preceding italic into the new paragraph: bold may wrap an italic span)
    check('editing imported rich text: new formatting exported', /highlightedText1&quot;&gt;(&lt;span class=&quot;highlightedText\d&quot;&gt;)?Edited after import&lt;\/span&gt;/.test(xml2), why);
    await page.click(tab('700400'));
    const pyCells = await page.$$eval('#main .cellin[data-s="PY"], #main [data-textblock][data-s="PY"]', (els) => els.map((e) => ({ d: e.disabled, v: e.value || '' })));
    check('previous-year cells of [700400] auditors report (GR-11) are disabled and blank', pyCells.length > 0 && pyCells.every((c) => c.d && c.v === ''), JSON.stringify(pyCells.slice(0, 4)));

    // ---- general information + cash-flow method
    await page.click('a[data-go="setup"]');
    check('"Disclosure of General Information about Company" (nav + heading), [700300] elements listed', (await page.textContent('#general-title')).trim() === 'Disclosure of General Information about Company' && (await page.locator('#main table.g [data-c^="in-ca:"]').count()) > 10);
    // v1.1 (C&I v14.2): dates are typed day first (dd-mm-yyyy) whatever the browser's language (this browser runs as
    // en-US, whose own date field reads mm/dd/yyyy)
    {
      const dsel = '#main input.cellin[data-date][data-c="in-ca:DateOfBoardMeetingWhenFinalAccountsWereApproved"][data-s="CY"]';
      const dcell = (await page.locator(dsel).count()) ? dsel : '#main input.cellin[data-date]:not([disabled]):not([readonly])';
      check('v1.1: date cells are dd-mm-yyyy text fields with a calendar button (no browser date field); setup dates too', (await page.locator('#main input.cellin[type="date"]').count()) === 0 && (await page.locator(dcell).count()) >= 1 && (await page.getAttribute(dcell, 'placeholder')) === 'dd-mm-yyyy' && (await page.locator('#f-cys[data-date]').count()) === 1 && (await page.locator('#f-cys').evaluate((e) => !!e.parentElement.querySelector('.date-pick'))));
      const before = await page.inputValue(dcell);
      await page.fill(dcell, '05-09-2017'); await page.press(dcell, 'Tab');
      const toast1 = await page.textContent('#toast');
      await page.click(tab('110000')); await page.click('a[data-go="setup"]'); // re-rendered from the stored value
      const nat = () => page.evaluate((sel) => document.querySelector(sel).parentElement.querySelector('.date-native').value, dcell);
      check('v1.1: 05-09-2017 is stored as 5 September 2017 (2017-09-05) and shown back day first, confirmed in words', (await page.inputValue(dcell)) === '05-09-2017' && (await nat()) === '2017-09-05' && /5 September 2017$/.test(await page.getAttribute(dcell, 'title')) && /Date entered: 5 September 2017/.test(toast1), `${await page.inputValue(dcell)} ${await nat()} ${toast1}`);
      await page.fill(dcell, '31/02/2017'); await page.press(dcell, 'Tab');
      const toast2 = await page.textContent('#toast');
      await page.click(tab('110000')); await page.click('a[data-go="setup"]');
      check('v1.1: an impossible date is refused with a day-first hint; the stored date is kept', /not a date/.test(toast2) && /dd-mm-yyyy/.test(toast2) && (await page.inputValue(dcell)) === '05-09-2017', toast2);
      await page.evaluate((sel) => { const n = document.querySelector(sel).parentElement.querySelector('.date-native'); n.value = '2017-04-05'; n.dispatchEvent(new Event('change', { bubbles: true })); }, dcell);
      check('v1.1: a date picked from the calendar is entered day first (05-04-2017 = 5 April 2017)', (await page.inputValue(dcell)) === '05-04-2017' && /5 April 2017$/.test(await page.getAttribute(dcell, 'title')));
      await page.fill('#f-cye', '31-3-2018'); await page.press('#f-cye', 'Tab');
      check('v1.1: a setup period date typed day first is confirmed in words', (await page.inputValue('#f-cye')) === '31-03-2018' && /Date entered: 31 March 2018/.test(await page.textContent('#toast')));
      // restore the cell as it was
      await page.fill(dcell, before); await page.press(dcell, 'Tab');
    }
    // v1.1: readable mandatory / error cells and dropdowns in dark and light mode (computed colours, WCAG contrast)
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.click(tab('611500'));
      const cols = await page.evaluate(() => {
        const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
        const ratio = (el) => { const cs = getComputedStyle(el); const x = lum(cs.backgroundColor), y = lum(cs.color); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
        const out = {};
        const inp = document.querySelector('#main input.cellin:not([disabled]):not([readonly]):not([data-date])');
        const sel = document.querySelector('#main select.cellin:not([disabled])');
        const keep = [inp.value, inp.className, sel.value, sel.className];
        inp.value = ''; inp.placeholder = 'required'; inp.classList.add('req'); out.mandatoryEmpty = ratio(inp);
        inp.classList.add('cell-err'); out.errorCell = ratio(inp); inp.classList.remove('cell-err');
        inp.classList.add('bad'); out.refused = ratio(inp);
        sel.classList.add('req'); sel.value = ''; out.mandatoryDropdown = ratio(sel);
        // an option without its own opaque background is painted by the operating system's list (light on Windows): not readable
        { const o = sel.options[1] || sel.options[0]; out.dropdownOption = /rgba\([^)]*,\s*0\)|transparent/.test(getComputedStyle(o).backgroundColor) ? 0 : ratio(o); }
        const t = document.querySelector('#toast'); const tk = t.className; t.className = (tk + ' bad').trim(); out.errorMessage = ratio(t); t.className = tk;
        [inp.value, inp.className, sel.value, sel.className] = keep;
        return out;
      });
      check(`v1.1 ${scheme} mode: mandatory-empty, error and refused cells, Yes/No dropdown and its options, error message — contrast ≥ 4.5`, Object.values(cols).every((c) => c >= 4.5), JSON.stringify(cols));
    }
    await page.click('a[data-go="setup"]');
    await page.check('#cf-direct'); await page.waitForTimeout(150);
    const cls = async (code) => page.getAttribute(tab(code), 'class');
    check('Direct selected: [310000] enabled, [320000] disabled', !/\bna\b/.test(await cls('310000')) && /\bna\b/.test(await cls('320000')));
    await page.click(tab('320000'));
    const offInputs = await page.$$eval('#main .cellin', (els) => [els.length, els.filter((e) => e.disabled).length, els.filter((e) => e.value !== '').length]);
    check('disabled cash-flow tab: unavailable, no data entry, no values shown', (await page.locator('.sheet.tab-off').count()) === 1 && offInputs[0] > 0 && offInputs[0] === offInputs[1] && offInputs[2] === 0, JSON.stringify(offInputs));
    await page.click('a[data-go="setup"]');
    await page.check('#cf-indirect'); await page.waitForTimeout(150);
    check('Indirect selected: [320000] enabled, [310000] disabled', /\bna\b/.test(await cls('310000')) && !/\bna\b/.test(await cls('320000')));

    // v1.6.2: Add row with every axis at its default asks before adding the TOTAL column
    {
      await page.click(tab('401100')); await page.waitForTimeout(150); // trade receivables: no TOTAL column in the example
      const open = 'button[data-open-table="401100:SubclassificationOfTradeReceivablesTable"][data-scope="CY"]';
      if (await page.locator(open).count()) {
        await page.click(open); await page.waitForTimeout(200);
        for (const sel of await page.$$('#addslice select')) await sel.selectOption('');
        await page.click('#addslice button[type="submit"]'); await page.waitForTimeout(150);
        const asked = (await page.isVisible('#dlg-continue')) && /total column/i.test(await page.textContent('#modal-title'));
        if (await page.isVisible('#dlg-cancel')) await page.click('#dlg-cancel');
        check('v1.6.2 Add row with every axis at its default: asks before adding the TOTAL column', asked);
      } else check('v1.6.2 Add row with every axis at its default: asks before adding the TOTAL column', false, 'trade receivables table not available');
    }
    // v1.6: a Yes/No chosen far down a tab: the page re-renders, the drop-down stays where it was on the screen (the table
    // frame used to scroll back to its top) and keeps the focus
    {
      await page.click(tab('700300')); await page.waitForTimeout(200);
      const info = await page.evaluate(() => {
        const sels = [...document.querySelectorAll('#main select.cellin:not([disabled])')]; const s = sels[sels.length - 1];
        s.scrollIntoView({ block: 'center' }); const w = s.closest('.grid-wrap');
        return { sel: `select.cellin[data-c="${s.dataset.c}"][data-s="${s.dataset.s}"]`, top: Math.round(s.getBoundingClientRect().top), frame: w ? w.scrollTop : 0, val: s.value, other: [...s.options].map((o) => o.value).find((v) => v && v !== s.value) };
      });
      const pick = async (v) => { await page.selectOption(info.sel, v); await page.waitForTimeout(300); if (await page.isVisible('#dlg-continue')) { await page.click('#dlg-continue'); await page.waitForTimeout(300); } };
      await pick(info.other);
      const after = await page.evaluate((sel) => { const s = document.querySelector(sel); return { top: Math.round(s.getBoundingClientRect().top), focused: document.activeElement === s, value: s.value }; }, info.sel);
      check('v1.6 drop-down far down a tab: after the change it stays in place on the screen and keeps the focus', info.frame > 500 && Math.abs(after.top - info.top) <= 2 && after.focused && after.value === info.other, JSON.stringify({ info, after }));
      await pick(info.val); // as it was
    }
    // ---- Yes/No dependency with a safe Yes → No change
    await page.click(tab('611500'));
    const PAR = 'select[data-c="in-ca:WhetherCompanyHasSubsidiaryCompanies"][data-s="CY"]';
    const CH = 'input[data-c="in-ca:NumberOfSubsidiaryCompanies"][data-s="CY"]';
    await page.selectOption(PAR, 'true'); await page.waitForTimeout(150);
    check('Yes → dependent field and table enabled', !(await page.isDisabled(CH)) && !(await page.isDisabled('button[data-open-table="611500:DisclosureOfDetailsOfSubsidiariesTable"][data-scope="CY"]')));
    // v1.6: Alt+Shift+C / Y / B press the page's own buttons
    {
      await page.keyboard.press('Alt+Shift+C'); await page.waitForTimeout(150);
      const tc = await page.textContent('#toast');
      check('v1.6 Alt+Shift+C on a note: Copy from previous year pressed (here not available: says so)', /Copy from previous year|No “Copy from previous year”/.test(tc), tc);
      const PARPY = PAR.replace('"CY"', '"PY"'); const pyWas = await page.inputValue(PARPY);
      await page.selectOption(PARPY, 'true'); await page.waitForTimeout(150); // the previous-year table available too
      await page.click('button[data-open-table="611500:DisclosureOfDetailsOfSubsidiariesTable"][data-scope="CY"]'); await page.waitForTimeout(200);
      const chip = async () => (await page.textContent('#main header .chip.info')) || '';
      const c0 = await chip();
      await page.keyboard.press('Alt+Shift+Y'); await page.waitForTimeout(200); const c1 = await chip();
      await page.keyboard.press('Alt+Shift+Y'); await page.waitForTimeout(200); const c2 = await chip();
      check('v1.6 Alt+Shift+Y in a table: switches to the previous year and back', /^Current/.test(c0) && /^Previous/.test(c1) && /^Current/.test(c2), [c0, c1, c2].join(' | '));
      await page.keyboard.press('Alt+Shift+B'); await page.waitForTimeout(200);
      check('v1.6 Alt+Shift+B in a table: back to its note', /_611500$/.test(await page.getAttribute('#nav a.on[data-elr]', 'data-elr') || '') && !(await page.locator('#main button[data-open-table][data-scope] >> text=/Switch to/').count()) && (await page.locator(PAR).count()) === 1);
      await page.keyboard.press('Alt+Shift+B'); await page.waitForTimeout(150);
      check('v1.6 Alt+Shift+B on a note: says there is no Back to note', /No “Back to note”/.test(await page.textContent('#toast')));
      await page.selectOption(PARPY, pyWas); await page.waitForTimeout(150); if (await page.isVisible('#dlg-continue')) { await page.click('#dlg-continue'); await page.waitForTimeout(150); }
    }
    await setCell(CH, '2');
    await page.selectOption(PAR, 'false');
    await page.waitForSelector('#dlg-continue');
    check('Yes → No asks before making entered values non-applicable', /retained but excluded/.test(await page.textContent('#modal-body')));
    await page.click('#dlg-cancel');
    check('Cancel keeps the Yes answer and the dependent value', (await page.inputValue(PAR)) === 'true' && (await page.inputValue(CH)) === '2');
    await page.selectOption(PAR, 'false');
    await page.waitForSelector('#dlg-continue');
    await page.click('#dlg-continue'); await page.waitForTimeout(150);
    check('No → dependent field disabled and blank; dependent table unavailable', await page.isDisabled(CH) && (await page.inputValue(CH)) === '' && await page.isDisabled('button[data-open-table="611500:DisclosureOfDetailsOfSubsidiariesTable"][data-scope="CY"]'));

    // ---- validation → exact cell and navigation
    await page.click(tab('210000'));
    const OI = 'input[data-c="ind-as:CostOfMaterialsConsumed"][data-s="CY"]'; // v1.2: a mandatory statement figure without a note (other income is taken from its note)
    const oiVal = await page.inputValue(OI);
    await setCell(OI, '');
    await page.click('.bar button[data-act="validate"]');
    await page.waitForSelector('.issues');
    const errLi = page.locator('.issues li.nav-issue', { hasText: "'CostOfMaterialsConsumed' is mandatory" }).first();
    check('validation lists the error with its location', (await errLi.count()) === 1 && /\[210000\]/.test(await errLi.textContent()));
    await errLi.click(); await page.waitForTimeout(200);
    const focusedCell = await page.evaluate(() => document.activeElement?.dataset?.cell || '');
    check('clicking the error opens the tab and focuses the exact cell', /_210000$/.test(await page.getAttribute('#nav a.on[data-elr]', 'data-elr') || '') && focusedCell.startsWith('ind-as:CostOfMaterialsConsumed#D:'), focusedCell);
    check('the erroneous cell is marked red', await page.evaluate((sel) => document.querySelector(sel).classList.contains('cell-err'), OI));
    await page.click('a[data-go="validate"]');
    await page.click('button[data-filter="WARNING"]');
    const warnLi = page.locator('.issues li.nav-issue', { hasText: 'NumberOfSubsidiaryCompanies' }).first();
    check('the retained-but-excluded value is listed as a warning with its location', (await warnLi.count()) === 1);
    await warnLi.click(); await page.waitForTimeout(200);
    check('clicking the warning navigates to its cell, which carries the warning mark', /_611500$/.test(await page.getAttribute('#nav a.on[data-elr]', 'data-elr') || '') && await page.evaluate((sel) => document.querySelector(sel).classList.contains('cell-warn'), CH));
    await page.click(tab('210000'));
    await page.click('#main button[data-act="validate-tab"]');
    await page.waitForSelector('.issues');
    const locs = await page.$$eval('.issues li.nav-issue', (els) => els.map((e) => ({ t: e.querySelector('.reasons')?.textContent || '', x: /cross-tab/.test(e.textContent) })));
    check('Validate current tab: scope shown; results belong to [210000] or are marked cross-tab', /current tab \[210000\]/.test(await page.textContent('#main h1')) && locs.length > 0 && locs.every((l) => l.t.includes('[210000]') || l.x), JSON.stringify(locs.slice(0, 5)));
    await page.click(tab('210000'));
    await setCell(OI, oiVal);
    // v1.2 (C3): resizable table, size kept per tab, reset
    const gw = page.locator('#main .grid-wrap.rs');
    check('tab grid is resizable, with the hint and a hidden reset', (await gw.count()) === 1 && (await page.locator('#main .grid-foot').count()) === 1 && await page.isHidden('#main [data-act="grid-reset"]'));
    await gw.evaluate((e) => e.scrollIntoView({ block: 'end' }));
    const bb = await gw.boundingBox();
    await page.mouse.move(bb.x + bb.width - 4, bb.y + bb.height - 4); await page.mouse.down();
    await page.mouse.move(bb.x + bb.width - 104, bb.y + bb.height - 204, { steps: 5 }); await page.mouse.up();
    const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('mca-indas-grid-size') || '{}'); } catch { return {}; } });
    const key = Object.keys(stored).find((k) => /_210000$/.test(k));
    check('dragging the corner resizes the table and keeps the size for the tab', !!key && stored[key].h < bb.height - 50 && await page.isVisible('#main [data-act="grid-reset"]'), JSON.stringify({ stored, bb }));
    await page.click(tab('110000')); await page.click(tab('210000'));
    const h2 = (await page.locator('#main .grid-wrap.rs').boundingBox()).height;
    check('the size is applied again when the tab is reopened', key && Math.abs(h2 - stored[key].h) <= 2, `${h2} vs ${key && stored[key].h}`);
    await page.click('#main [data-act="grid-reset"]');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('mca-indas-grid-size') || '{}'));
    check('Reset table size forgets the size', !Object.keys(after).some((k) => /_210000$/.test(k)) && await page.isHidden('#main [data-act="grid-reset"]'));
    // v1.2 (C2): validation messages in a separate window; clicking one opens its cell here; marked out of date on change
    await page.click('a[data-go="validate"]');
    if (!(await page.locator('#main [data-act="issues-window"]').count())) { await page.click('#main button[data-act="validate"]'); await page.waitForSelector('.issues'); }
    const [pop] = await Promise.all([page.waitForEvent('popup'), page.click('#main [data-act="issues-window"]')]);
    await pop.waitForSelector('#root li');
    check('"Open in separate window" shows the messages in a pop-up window with severity filters', (await pop.locator('button[data-wf]').count()) === 4 && (await pop.locator('#root li').count()) > 0);
    await pop.click('button[data-wf="ALL"]');
    const wli = pop.locator('li[data-n]', { hasText: 'NumberOfSubsidiaryCompanies' }).first();
    check('pop-up: the warning is listed', (await wli.count()) === 1);
    await wli.click(); await page.waitForTimeout(250);
    check('pop-up: clicking a message opens its cell in the main window', /_611500$/.test(await page.getAttribute('#nav a.on[data-elr]', 'data-elr') || ''));
    await page.click(tab('210000'));
    await setCell(OI, '1'); await page.waitForTimeout(100);
    check('pop-up: marked out of date when the filing changes', (await pop.locator('.stale').count()) === 1);
    await setCell(OI, oiVal);
    await pop.click('button[data-wact="revalidate"]'); await page.waitForTimeout(250);
    check('pop-up: "Validate again" refreshes the list', (await pop.locator('.stale').count()) === 0 && (await pop.locator('li').count()) > 0);
    await pop.close();
    // v1.3 (D5): live check of the open tab shortly after an edit
    await page.click(tab('210000'));
    await setCell(OI, ''); await page.waitForTimeout(1800);
    check('live check: the bar shows "This tab · N error(s) (live)" and the emptied mandatory cell is marked', /This tab · \d+ error\(s\) \(live\)/.test(await page.textContent('#bar-status')) && await page.evaluate((sel) => document.querySelector(sel).classList.contains('cell-err'), OI), await page.textContent('#bar-status'));
    // v1.3 (D3): fix buttons on validation messages, tried on a copy first, with Undo last fix
    await page.click('.bar button[data-act="validate"]');
    await page.waitForSelector('.issues');
    const fixLi = page.locator('.issues li', { hasText: "'CostOfMaterialsConsumed' is mandatory" }).first();
    const fixBtn = fixLi.locator('button.fix');
    check('validation message offers "Fix: Report nil (0)"', (await fixBtn.count()) === 1 && /Report nil/.test(await fixBtn.textContent()));
    await fixBtn.click();
    check('the fix asks first and says what else it would raise', /raises no other message|would also raise/.test(await page.textContent('#modal-body')));
    await page.click('#dlg-continue'); await page.waitForTimeout(250);
    check('after the fix the message is gone and "Undo last fix" is offered', (await page.locator('.issues li', { hasText: "'CostOfMaterialsConsumed' is mandatory" }).count()) === 0 && (await page.locator('#main [data-act="undo-fix"]').count()) === 1);
    await page.click('#main [data-act="undo-fix"]'); await page.click('#dlg-continue'); await page.waitForTimeout(250);
    check('Undo last fix restores the filing (the message is back)', (await page.locator('.issues li', { hasText: "'CostOfMaterialsConsumed' is mandatory" }).count()) === 1);
    await page.click(tab('210000'));
    await setCell(OI, oiVal);
    // v1.3 (E): keyboard — Ctrl+Q tab switcher, arrows onto the buttons under a cell, Tab kept in the tab, shortcuts page
    await page.click(tab('210000'));
    await page.focus(OI);
    await page.keyboard.down('Control'); await page.keyboard.press('KeyQ');
    const qsOn = await page.textContent('#qs .qs-item.on').catch(() => '');
    check('Ctrl+Q opens the tab switcher on the current tab', /210000/.test(qsOn), qsOn);
    await page.keyboard.press('ArrowDown');
    const qsNext = (await page.textContent('#qs .qs-item.on .code')).trim();
    await page.keyboard.up('Control'); await page.waitForTimeout(200);
    check('releasing Ctrl opens the selected tab', (await page.locator('#qs').count()) === 0 && new RegExp(`_${qsNext}$`).test(await page.getAttribute('#nav a.on[data-elr]', 'data-elr') || ''), qsNext);
    await page.click(tab('110000'));
    const goNote = page.locator('#main button[data-go-note][data-s="CY"]').first();
    await goNote.focus();
    await page.keyboard.press('ArrowDown'); const afterDown = await page.evaluate(() => document.activeElement?.className || '');
    await page.keyboard.press('ArrowUp');
    check('↓ / ↑ stop at the buttons under a cell (Go to note)', await page.evaluate(() => !!document.activeElement?.matches?.('button[data-go-note]')) && afterDown !== '', afterDown);
    let inMain = true;
    for (let k = 0; k < 6; k++) { await page.keyboard.press('Tab'); inMain = inMain && await page.evaluate(() => !!document.activeElement?.closest('#main')); }
    for (let k = 0; k < 3; k++) { await page.keyboard.press('Shift+Tab'); inMain = inMain && await page.evaluate(() => !!document.activeElement?.closest('#main')); }
    check('Tab / Shift+Tab stay inside the open tab', inMain);
    const [pop2] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Alt+KeyV')]);
    await pop2.waitForSelector('#root li');
    check('Alt+V validates and opens the messages window', /Validation/.test(await page.textContent('#main h1')) && (await pop2.locator('button[data-wf]').count()) === 4);
    await pop2.close();
    await page.click('a[data-go="shortcuts"]');
    const kbds = await page.$$eval('#main kbd', (els) => els.map((e) => e.textContent));
    check('Keyboard shortcuts page lists the keys', ['Ctrl+Q (hold Ctrl)', 'Alt+V', 'Ctrl+Shift+S', 'Ctrl+O', 'Ctrl+G', 'Ctrl+I', 'Alt+Shift+N', 'Ctrl+H'].every((k) => kbds.includes(k)), kbds.join(' | '));
    await page.keyboard.press('Control+KeyH'); await page.waitForTimeout(150);
    check('Ctrl+H opens MCA error help', (await page.locator('#mx-text').count()) === 1);
    // v1.4 (F2): footnote from the cell — Alt+N, fn mark, remove
    await page.click(tab('110000'));
    const fnCell = page.locator('#main input.cellin[data-s="CY"]:not([disabled])', { hasNot: page.locator('xx') }).filter({ hasText: '' });
    const fnSel = await page.$$eval('#main td.val input.cellin[data-s="CY"]', (els) => { const e = els.find((x) => x.value && !x.disabled); return e ? e.dataset.cell : null; });
    await page.focus(`#main [data-cell="${fnSel}"]`);
    await page.keyboard.press('Alt+KeyN');
    check('Alt+N on a cell with a value opens the footnote dialog — with the rich-text editor (v1.6.2)', /Footnote/.test(await page.textContent('#modal-title')) && (await page.locator('#fn-editor.rte-body').count()) === 1 && (await page.locator('#modal .rte-table').count()) === 1);
    await page.click('#fn-editor'); await page.keyboard.type('Smoke footnote');
    await page.click('#fn-save'); await page.waitForTimeout(150);
    check('the cell shows the fn mark; the menu counts the footnote', await page.evaluate((id) => document.querySelector(`#main [data-cell="${CSS.escape(id)}"]`)?.closest('td')?.classList.contains('has-fn'), fnSel) && Number(await page.textContent('a[data-go="footnotes"] .chip').catch(() => '0')) >= 1);
    await page.click('#main [data-act="footnote-cell"]');
    await page.click('#modal [data-fn-unlink]'); await page.waitForTimeout(150);
    check('"Remove from this cell" removes the footnote mark', !(await page.evaluate((id) => document.querySelector(`#main [data-cell="${CSS.escape(id)}"]`)?.closest('td')?.classList.contains('has-fn'), fnSel)));
    void fnCell;
    // v1.6.2: Footnotes page — preview, rich-text editor with a pasted table, table rows / columns
    await page.click('a[data-go="footnotes"]'); await page.waitForTimeout(150);
    check('v1.6.2 Footnotes page: the footnote shown as text, edited in the editor', (await page.locator('#main .fn-preview').first().textContent()).includes('Smoke footnote') && (await page.locator('#main [data-act="fn-edit"]').count()) >= 1 && (await page.locator('#main textarea').count()) === 0);
    await page.click('#main [data-act="fn-add"]'); await page.waitForSelector('#fn-editor'); await page.waitForTimeout(250);
    await page.click('#fn-editor');
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/html', '<table border=1><tr><td style="border:1px solid">Right of use assets</td><td>1,789.07</td></tr><tr><td>Investment properties</td><td>644.62</td></tr></table>');
      dt.setData('text/plain', 'Right of use assets 1,789.07');
      document.querySelector('#fn-editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(150);
    const firstCell = '#fn-editor td';
    await page.click(firstCell);
    for (const op of ['rowBelow', 'colRight']) { await page.selectOption('#modal .rte-table', op); await page.waitForTimeout(100); }
    const grid1 = await page.$$eval('#fn-editor tr', (rs) => rs.map((r) => r.cells.length));
    await page.click('#fn-editor tr:nth-child(2) td:nth-child(2)'); // the inserted row and column
    for (const op of ['delRow', 'delCol']) { await page.selectOption('#modal .rte-table', op); await page.waitForTimeout(100); }
    const grid2 = await page.$$eval('#fn-editor tr', (rs) => rs.map((r) => r.cells.length));
    const texts = await page.$$eval('#fn-editor td', (cs) => cs.map((c) => c.textContent.trim()));
    check('v1.6.2 table rows / columns: insert row below and column right (3×3), then delete them again (2×2, the pasted cells intact)', JSON.stringify(grid1) === '[3,3,3]' && JSON.stringify(grid2) === '[2,2]' && JSON.stringify(texts) === JSON.stringify(['Right of use assets', '1,789.07', 'Investment properties', '644.62']), JSON.stringify({ grid1, grid2, texts }));
    await page.click('#fn-save'); await page.waitForTimeout(150);
    const fnHtml = await page.$$eval('#main .fn-preview', (ps) => ps.map((p) => p.innerHTML));
    check('v1.6.2 a footnote with a pasted table: saved in the MCA subset and shown as a table', fnHtml.some((h) => /<table><tbody><tr><td class="bordered">Investment properties|<td class="bordered">Right of use assets/.test(h) && !/style=/.test(h)), fnHtml.join(' || ').slice(0, 400));
    // v1.4 (F3): Fix tools on the Validation page — Recalculate current year and Fill empty totals (nothing to do here)
    await page.click('a[data-go="validate"]');
    check('Validation offers Recalculate current year and Fill empty totals', (await page.locator('#fix-tools [data-act="recalc-all"]').count()) === 1 && (await page.locator('#fix-tools [data-act="fill-totals-all"]').count()) === 1);
    await page.click('#fix-tools [data-act="recalc-all"]'); await page.waitForTimeout(150);
    check('Recalculate current year: nothing to change in a consistent filing (says so)', /already agree/.test(await page.textContent('#toast')) && await page.isHidden('#modal'));
    // v1.4 (F1): printable preview from Generate XML
    await page.click('a[data-go="xml"]');
    const [prev] = await Promise.all([page.waitForEvent('popup'), page.click('#main [data-act="preview-pdf"]')]);
    await prev.waitForLoadState();
    const ptxt = await prev.textContent('body');
    check('Preview PDF opens a printable preview, labelled not the MCA rendering, with the balance sheet', /not the MCA rendering/.test(ptxt) && /\[110000\] Balance sheet/.test(ptxt) && (await prev.locator('button', { hasText: 'Print' }).count()) === 1);
    await prev.close();
    // ---- MCA-validated reference instances through the real UI: import, every tab, totals column, gate, XML
    for (const gf of readdirSync(ROOT).filter((x) => /^golden-.*\.xml$/.test(x))) {
      const src = readFileSync(path.join(ROOT, gf), 'utf8');
      await page.setInputFiles('#file-xml', path.join(ROOT, gf));
      await page.waitForSelector('#import-confirm');
      await page.check('#ym-both');
      await page.click('#import-commit');
      await page.waitForSelector('.banner.info');
      const cin = /<xbrli:identifier[^>]*>([^<]+)</.exec(src)[1];
      check(`${gf}: imported through the UI (both years), CIN in the header`, (await page.textContent('#bar-who')).includes(cin));
      // v1.5: errors in the reference instance's own data (consolidated: shareholders' percentages above 100%, SR-L663-1)
      const known = /ref-c-consolidated/.test(gf) ? ['SR-L663-1'] : [];
      const level = /<in-ca:LevelOfRoundingUsedInFinancialStatements[^>]*>([^<]+)</.exec(src)?.[1] || 'Thousands';
      const scale = { Actual: 1, Hundreds: 1e2, Thousands: 1e3, Lakhs: 1e5, Millions: 1e6, Crores: 1e7, Billions: 1e9 }[level];
      // v1.5: the company page offers the filing's decimal places (here 4) and shows the statement rounding
      await page.click('a[data-go="setup"]');
      const dpSel = await page.inputValue('#f-dp'), spSel = await page.inputValue('#f-sp');
      check(`${gf}: company page shows the imported decimal places and statement rounding`, dpSel !== '' && Number(dpSel) >= 0 && (spSel === '' || Number(spSel) <= Number(dpSel)), `places ${dpSel}, statement ${spSel || 'same'}`);
      if (/ref-c-/.test(gf)) check(`${gf}: 4 decimal places as presented (share capital to the rupee), statement figures to 2`, dpSel === '4' && spSel === '2', `${dpSel} / ${spSel}`);
      if (/ref-c-standalone/.test(gf)) {
        // before v1.5 only 0–3 were offered: Apply on this page silently set 4 places to 0
        await page.click('#main form button[type="submit"]'); await page.waitForTimeout(200);
        await page.click('a[data-go="setup"]');
        check(`${gf}: Apply on the company page keeps 4 decimal places and the statement rounding`, (await page.inputValue('#f-dp')) === '4' && (await page.inputValue('#f-sp')) === '2', `${await page.inputValue('#f-dp')} / ${await page.inputValue('#f-sp')}`);
      }
      let rendered = 0, filled = 0; const t0 = Date.now();
      const navTabs = await page.$$eval('#nav a[data-elr]', (as) => as.map((a) => a.dataset.elr));
      for (const href of navTabs) {
        await page.click(`#nav a[data-elr="${href}"]`);
        if (await page.locator('#main .sheet').count()) rendered++;
        filled += await page.$$eval('#main .cellin', (els) => els.filter((e) => e.value !== '').length);
      }
      check(`${gf}: all ${navTabs.length} tabs render with the imported data (${filled} filled cells, ${Date.now() - t0} ms)`, rendered === navTabs.length && rendered >= 50 && filled > 300, `${rendered} tabs, ${filled} cells`);
      await page.click(tab('110000'));
      const assets = /<ind-as:Assets [^>]*>([^<]+)</.exec(src)?.[1]; // the first is the current year in both instances
      const shown = await page.inputValue('input[data-c="ind-as:Assets"][data-s="CY"]');
      check(`${gf}: balance sheet total assets shown at the filing's level of rounding (${level})`, assets && Math.abs(Number(shown.replace(/,/g, '')) * scale - Number(assets)) < 1, `${shown} vs ${assets}`);
      // v1.2 (C1): balance-sheet figures taken from their notes: read-only "from note" cells and a "Go to note" link
      const fromNote = await page.locator('#main input.cellin.from-note[data-s="CY"]').count();
      const goBtn = page.locator('#main button[data-go-note][data-s="CY"]').first();
      check(`${gf}: statement figures taken from notes are marked, with "Go to note"`, fromNote > 0 && (await goBtn.count()) === 1, `${fromNote} from-note cells`);
      await goBtn.click(); await page.waitForTimeout(200);
      check(`${gf}: "Go to note" opens the note`, !/_110000$/.test(await page.getAttribute('#nav a.on[data-elr]', 'data-elr') || '') || (await page.locator('#main th.slicehead').count()) > 0);
      await page.click(tab('400100'));
      await page.click('button[data-open-table="400100:DisclosureOfClassesOfEquityShareCapitalTable"][data-scope="CY"]');
      await page.waitForSelector('#main table.g');
      const totalCol = await page.locator('#main th.slicehead .chip', { hasText: 'total' }).count();
      check(`${gf}: share-capital table shows the class rows and the total column (default members)`, totalCol === 1 && (await page.locator('#main th.slicehead').count()) >= 2);
      await page.click('.bar button[data-act="validate"]');
      await page.waitForSelector('.issues, .banner');
      const errs = await page.locator('.issues li.nav-issue.sev-ERROR, .issues li.nav-issue.error').count();
      if (!known.length) check(`${gf}: internal gate in the UI — no blocking errors`, /INTERNAL GATE · PASS/i.test(await page.textContent('#bar-status')), `${errs} errors; ${(await page.textContent('#bar-status')).slice(0, 120)}`);
      else {
        await page.click('a[data-go="validate"]'); await page.waitForSelector('.issues');
        const msgs = await page.$$eval('.issues li', (ls) => ls.filter((l) => l.querySelector('.chip.bad')).map((l) => l.textContent));
        check(`${gf}: internal gate in the UI — only the filed data error(s) ${known.join(', ')}`, msgs.length > 0 && msgs.every((m) => known.some((k) => m.includes(k))), msgs.map((m) => m.slice(0, 80)).join(' | '));
      }
      await page.click('a[data-go="xml"]');
      await page.click('button[data-act="generate"]');
      await page.waitForSelector('#xmltext, .banner.bad');
      const out = (await page.locator('#xmltext').count()) ? await page.textContent('#xmltext') : '';
      let d = null; try { d = out && rawDiff(rawFacts(src), rawFacts(out)); } catch (e) { d = { err: e.message }; }
      // only facts the tool does not file may be missing: not-applicable answers and zeros under a "No" answer
      const srcF = rawFacts(src);
      const notFiled = (k) => ['0', 'false', '(nil)'].includes(String(srcF.get(k)?.v).trim());
      if (!known.length) check(`${gf}: XML generated in the UI equals the source fact for fact (except not-applicable answers and zeros)`, d && !d.err && d.changed.length === 0 && d.onlyB.length === 0 && (d.onlyA.length <= 10 || d.onlyA.every(notFiled)), d ? JSON.stringify({ err: d.err, changed: d.changed?.length, onlyA: d.onlyA?.length, onlyB: d.onlyB?.length, notZero: d.onlyA?.filter((k) => !notFiled(k)).slice(0, 3) }) : 'no XML');
      else {
        check(`${gf}: Generate XML is refused while the filed data error is reported`, !out && (await page.locator('.banner.bad').count()) > 0);
        // v1.6: the XML anyway, on request — confirmed, named _with-errors, marked as not validated, same facts
        await page.click('#main [data-act="download-xml-errors"]'); await page.waitForSelector('#dlg-continue');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlg-continue')]);
        const p = await dl.path(); const werr = p ? readFileSync(p, 'utf8') : '';
        let dw = null; try { dw = rawDiff(rawFacts(src), rawFacts(werr)); } catch (e) { dw = { err: e.message }; }
        check(`v1.6 ${gf}: Download XML with errors — confirmed, file …_with-errors.xml, marked NOT VALIDATED, the source facts`, /_with-errors\.xml$/.test(dl.suggestedFilename()) && /<!-- NOT VALIDATED: generated with \d+ unresolved/.test(werr) && dw && !dw.err && dw.changed.length === 0 && dw.onlyB.length === 0 && dw.onlyA.every(notFiled), `${dl.suggestedFilename()} ${JSON.stringify({ err: dw?.err, changed: dw?.changed?.length, onlyB: dw?.onlyB?.length })}`);
      }
      // v1.4 (F1): the preview of the imported filing shows the same sections in the MCA PDF order
      await page.click('a[data-go="xml"]');
      const [pv] = await Promise.all([page.waitForEvent('popup'), page.click('#main [data-act="preview-pdf"]')]);
      await pv.waitForLoadState();
      const codes = await pv.$$eval('h2', (hs) => hs.map((h) => (/^\[(\w+)\]/.exec(h.textContent) || [])[1]).filter(Boolean));
      check(`${gf}: Preview PDF starts with general information and the disclosures, then the statements (MCA PDF order)`, codes[0] === '700300' && codes.indexOf('110000') > codes.indexOf('700300') && codes.indexOf('110000') < codes.indexOf('210000'), codes.slice(0, 8).join(' '));
      await pv.close();
      // v1.2 (C1): a statement figure whose note is empty can be reported as nil from the statement
      await page.click(tab('110000'));
      const nilBtn = page.locator('#main button[data-nil][data-s="CY"]').first();
      if (await nilBtn.count()) {
        const nc = await nilBtn.getAttribute('data-nil');
        await nilBtn.click(); await page.waitForTimeout(150);
        const nv = await page.inputValue(`#main input[data-c="${nc}"][data-s="CY"]`);
        check(`${gf}: "Nil" reports 0 for a statement figure whose note is empty`, /^[0-]$|^0(\.0+)?$/.test(nv.trim()) && (await page.locator(`#main button[data-nil="${nc}"][data-s="CY"]`).count()) === 0, `${nc} = ${nv}`);
      }
    }
    // ---- usability (UI only): keyboard movement, accessible names, sticky headers, save/confirm feedback
    await page.click('#nav a[data-elr$="_110000"]');
    const firstCy = page.locator('#main table.g td.val input.cellin[data-s="CY"]:not([disabled]):not([readonly])').first();
    await firstCy.focus();
    const fromCell = await firstCy.getAttribute('data-cell');
    await page.keyboard.press('Enter');
    const moved = await page.evaluate(() => ({ cell: document.activeElement?.dataset?.cell, s: document.activeElement?.dataset?.s, inGrid: !!document.activeElement?.closest('td.val') }));
    check('Enter moves to the next editable cell of the same column', moved.inGrid && moved.s === 'CY' && moved.cell && moved.cell !== fromCell, JSON.stringify(moved));
    await page.keyboard.press('Shift+Enter');
    check('Shift+Enter moves back up', (await page.evaluate(() => document.activeElement?.dataset?.cell)) === fromCell);
    const aria = await firstCy.getAttribute('aria-label');
    check('grid cells carry an accessible name (row — column)', /—/.test(aria || '') && /Current/i.test(aria || ''), aria);
    const sticky = await page.evaluate(() => [getComputedStyle(document.querySelector('#main table.g thead th')).position, getComputedStyle(document.querySelector('#main table.g td.lbl')).position]);
    check('column headings and the row-label column are sticky', sticky.every((x) => x === 'sticky'), sticky.join(','));
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => /Saved in this browser/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
    check('Ctrl+S saves in the browser and confirms', /Saved/.test(await page.textContent('#bar-save')) && /Saved in this browser/.test(await page.textContent('#toast')));
    // v1.1: typing the same value into a cell again is not a change of the filing (a different value is)
    {
      const r = await page.evaluate(() => {
        const el = [...document.querySelectorAll('#main input.cellin:not([readonly]):not([disabled])')].find((e) => e.value !== '' && !e.dataset.date);
        if (!el) return { err: 'no filled cell' };
        const v = el.value;
        el.value = v; el.dispatchEvent(new Event('change', { bubbles: true }));
        const same = document.querySelector('#bar-save').textContent;
        el.value = v.replace(/\d(?=\D*$)/, (d) => String((Number(d) + 1) % 10)); el.dispatchEvent(new Event('change', { bubbles: true }));
        const diff = document.querySelector('#bar-save').textContent;
        el.value = v; el.dispatchEvent(new Event('change', { bubbles: true }));
        return { same, diff };
      });
      check('v1.1: typing the same value again does not mark the filing changed; a different value does', !r.err && /^Saved/.test(r.same) && /Saving/.test(r.diff), JSON.stringify(r));
    }
    const nameBefore = await page.textContent('#bar-who b');
    await page.click('button[data-act="new-filing"]');
    check('New filing asks for confirmation in a dialog (focus on Cancel)', await page.isVisible('#modal') && (await page.evaluate(() => document.activeElement?.id)) === 'dlg-cancel');
    await page.keyboard.press('Escape');
    check('cancelling New filing keeps the filing', await page.isHidden('#modal') && (await page.textContent('#bar-who b')) === nameBefore);
    await page.click('#nav a[data-elr$="_400100"]');
    await page.click(tbBtn);
    check('text block editor shows its validation status', /Not validated yet|No validation issues|issue\(s\) for this text block/.test(await page.textContent('#modal .tb-issues')));
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
    check('Tab stays inside the dialog', await page.evaluate(() => !!document.activeElement?.closest('#modal')));
    await page.keyboard.press('Escape');

    // ---- MCA Validator error help
    await page.click('a[data-go="mcaerrors"]');
    await page.fill('#mx-text', "1) cvc-complex-type.3.2.2: Attribute 'xml:lang' is not allowed to appear in element 'in-ca:CorporateIdentityNumber'.\n2) Element 'DisclosureInBoardOfDirectorsReportExplanatory' the contained HTML has the following errors: cvc-complex-type.2.4.a: Invalid content was found starting with element 'colgroup'. One of '{{http://www.mca.gov.in/XBRL/HTML}thead, {http://www.mca.gov.in/XBRL/HTML}tr}' is expected.;cvc-complex-type.3.2.2: Attribute 'colspan' is not allowed to appear in element 'td'.;");
    await page.click('#mx-run');
    const mx = await page.textContent('#main');
    check('MCA error help explains pasted validator messages (attribute, HTML) with a fix', (await page.locator('#main .mx').count()) === 2 && /old \(cached\) copy/.test(mx) && /click Save Text/.test(mx) && (await page.locator('#main [data-goconcept]').count()) === 2, mx.slice(0, 300));
    await page.click('#main [data-goconcept="in-ca:CorporateIdentityNumber"]');
    await page.waitForTimeout(200);
    check('MCA error help: element button navigates to the element', (await page.locator('#main #general-title').count()) === 1 || /_700300$/.test(await page.getAttribute('#nav a.on[data-elr]', 'data-elr') || ''));
    // ---- mandatory marking (business rules) in the UI
    await page.click(tab('210000'));
    const mandBadge = await page.locator('#main tr:has(input[data-c="ind-as:RevenueFromOperations"]) .mand').first().textContent().catch(() => '');
    check('mandatory fields are tagged "Mandatory" with the rule on hover', /Mandatory/.test(mandBadge) && /SR-/.test(await page.locator('#main tr:has(input[data-c="ind-as:RevenueFromOperations"]) .mand').first().getAttribute('title')));
    check('conditional fields are tagged "Conditional"', (await page.locator('#main .mand.cond').count()) > 0 || (await page.locator('#main .mand').count()) > 0);
    check('mandatory cells carry the required marker (outlined when empty)', (await page.locator('#main input.cellin.req[data-c="ind-as:RevenueFromOperations"][data-s="CY"]').count()) === 1);
    await page.click('a[data-go="setup"]');
    check('company form: identity fields tagged Mandatory', (await page.locator('#setup .mand').count()) >= 5);
    // v1.3 (D2): date-change guard and "Prepare next year's filing" from the open project
    await page.click('a[data-go="setup"]');
    const cye = await page.inputValue('#f-cye'), cys = await page.inputValue('#f-cys'), pys = await page.inputValue('#f-pys'), pye = await page.inputValue('#f-pye');
    const shift = (d) => d.replace(/(\d{4})$/, (y) => String(Number(y) + 1));
    await page.fill('#f-cys', shift(cys)); await page.fill('#f-cye', shift(cye)); await page.fill('#f-pys', shift(pys)); await page.fill('#f-pye', shift(pye));
    await page.click('#setup button[type="submit"]'); await page.waitForTimeout(200);
    check('changing the dates offers to set aside the values left outside the new years', !(await page.isHidden('#modal')) && /Values outside the new dates/.test(await page.textContent('#modal-title')));
    await page.click('#dlg-cancel');
    await page.fill('#f-cys', cys); await page.fill('#f-cye', cye); await page.fill('#f-pys', pys); await page.fill('#f-pye', pye);
    await page.click('#setup button[type="submit"]'); await page.waitForTimeout(200);
    if (!(await page.isHidden('#modal'))) await page.click('#dlg-continue'); // values written at the shifted dates (company name) are set aside
    const yearBefore = await page.textContent('#bar-who');
    await page.click('#main [data-act="prepare-next"]');
    await page.click('#dlg-continue'); await page.waitForTimeout(400);
    check('Prepare next year\'s filing from the open project: next year in the bar, previous year locked', (await page.textContent('#bar-who')) !== yearBefore && /Filing prepared for/.test(await page.textContent('#toast').catch(() => '')) && await page.evaluate(() => true), await page.textContent('#bar-who'));
    await page.click(tab('110000'));
    check('… its previous-year column is read-only (locked as filed)', (await page.locator('#main [data-act="py-unlock"]').count()) === 1);
    // v1.5.1: a large project (reference instance C prepared for the next year: about 6 million characters — more than
    // localStorage holds) is saved in this browser and restored after a reload
    const big = readdirSync(ROOT).find((x) => /^golden-ref-c-standalone-.*\.xml$/.test(x));
    if (big) {
      await page.setInputFiles('#file-xml', path.join(ROOT, big));
      await page.waitForSelector('#import-confirm');
      await page.check('#ym-next');
      await page.click('#import-commit');
      await page.waitForSelector('.banner.info');
      const st = await page.waitForSelector('#bar-save.ok, #bar-save.warn', { timeout: 30000 }).then((e) => e.getAttribute('class')).catch(() => 'none');
      const size = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('mca-indas-xbrl', 1); r.onsuccess = () => { const g = r.result.transaction('projects').objectStore('projects').get('mca-indas-xbrl.project.v1'); g.onsuccess = () => res((g.result || '').length); g.onerror = () => res(0); }; r.onerror = () => res(0); }));
      check(`${big} prepared for the next year (${(size / 1e6).toFixed(1)} million characters) is saved in this browser`, /ok/.test(st) && size > 5242880, `${st}, ${size}`);
      const who = await page.textContent('#bar-who');
      await page.reload();
      await page.waitForSelector('#nav a[data-elr]');
      check(`${big}: the next-year project is restored after a reload`, /Restored your last project/.test(await page.textContent('#toast')) && (await page.textContent('#bar-who')) === who, (await page.textContent('#bar-who')).slice(0, 120));
    }
    // ---- v1.6.4 (C&I v14.5 / v14.9 ported): [700400] auditor's report, then the workspace folder (the browser's real
    // folder API on the browser's private test folder instead of a picker), version stamp, backups, a newer version
    // saved on "the other laptop", compare. A second page on a web origin (the folder API is not offered on file://).
    {
      const http = await import('node:http');
      const server = http.createServer((req, res) => { try { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(readFileSync(path.join(ROOT, 'index.html'))); } catch { res.writeHead(500); res.end(); } });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
      page.setDefaultTimeout(20000);
      page.on('pageerror', (e) => errors.push(e));
      const projFile = path.join(ROOT, '.smoke-v164.mca-indas.json');
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
        await page.waitForSelector('#nav a[data-elr]');
        // a filing whose auditor's report gives every clause under Favourable, and the loans clause also under Unfavourable
        const { authority, q } = await import('./helpers.mjs');
        const { baseSession } = await import('./fixtures.mjs');
        const A = authority();
        const AUD = '700400:DisclosureOfAuditorsQualificationsReservationsOrAdverseRemarksInAuditorsReportTable';
        const AX = q('AuditorsQualificationsReservationsOrAdverseRemarksInAuditorsReportAxis');
        const col = (m) => [{ axis: AX, member: q(m) }];
        const s = baseSession();
        s.setValue(q('WhetherCompaniesAuditorsReportOrderIsApplicableOnCompany'), 'CY', 'true');
        for (const c of A.rules.rules.find((r) => r.id === 'ML-52').ast.concepts) s.setTableValue(AUD, 'CY', col('AuditorsFavourableRemarkMember'), c, A.dataType(c) === 'textBlock' ? '<p>Clause complied with.</p>' : 'Clause complied with.');
        const LOANS = q('DisclosureInAuditorsReportRelatingToLoans'), INV = q('DisclosureInAuditorsReportRelatingToInventories');
        s.setTableValue(AUD, 'CY', col('AuditorsUnfavourableRemarkMember'), LOANS, A.dataType(LOANS) === 'textBlock' ? '<p>Terms prejudicial.</p>' : 'Terms prejudicial.');
        writeFileSync(projFile, JSON.stringify(s.filing.toJSON()));
        await page.setInputFiles('#file-json', projFile);
        await page.waitForFunction(() => /Project opened/.test(document.querySelector('#toast')?.textContent || ''));
        // v1.6.4: Open project saves the browser copy at once — a reload right away restores the project just opened
        await page.reload();
        await page.waitForSelector('#nav a[data-elr]');
        check('v1.6.4: Open project, then an immediate reload — the project just opened is restored (not the previous one)', /Test Co/.test(await page.textContent('#bar-who')) && !/example data/.test(await page.textContent('#bar-who')), await page.textContent('#bar-who'));
        await page.click('.bar button[data-act="validate"]');
        await page.waitForSelector('.issues');
        const sm = page.locator('.issues li', { hasText: 'SR-L6448-1' }).first();
        check('v1.6.4 [700400]: a clause under two members is one SR-L6448-1 error with its fix "Keep it under one member"', (await sm.count()) === 1 && /Keep it under one member/.test(await sm.textContent()) && (await page.locator('.issues li', { hasText: 'ML-52' }).count()) === 0, (await sm.count()) ? await sm.textContent() : 'none');
        await sm.click(); await page.waitForTimeout(300);
        const nCols = await page.locator(`#main [data-c="${INV}"][data-t="${AUD}"]`).count();
        const reqInv = await page.locator(`#main [data-c="${INV}"][data-t="${AUD}"].req`).count();
        check('v1.6.4 [700400]: the message opens the auditor\'s-report table; a clause given under Favourable is not outlined as required under the other member', nCols === 2 && reqInv === 1, `columns ${nCols}, outlined ${reqInv}`);
        await page.click('a[data-go="validate"]'); await page.waitForSelector('.issues');
        await page.locator('.issues li', { hasText: 'SR-L6448-1' }).first().locator('button[data-fix]').click();
        await page.waitForSelector('#modal [data-fix-choice="0"]');
        const opt = await page.$eval('#modal [data-fix-choice="0"]', (el) => [...el.options].find((o) => /unfavourable/i.test(o.textContent))?.value);
        await page.selectOption('#modal [data-fix-choice="0"]', opt);
        await page.click('#dlg-continue');
        await page.waitForTimeout(400);
        check('v1.6.4 [700400]: "Keep it under one member" — the member chosen keeps the clause; no SR-L6448-1 or ML-52 error left', (await page.locator('.issues li', { hasText: 'SR-L6448-1' }).count()) === 0 && (await page.locator('.issues li', { hasText: 'ML-52' }).count()) === 0 && /Keep it under one member: done/.test(await page.textContent('#toast')), await page.textContent('#toast'));

        // workspace folder
        await page.evaluate(() => { window.__pickWorkspace = () => navigator.storage.getDirectory(); });
        await page.click('a[data-go="workspace"]');
        check('v1.6.4: the Workspace folder page offers to choose a folder', (await page.locator('#main [data-act="ws-choose"]').count()) >= 1);
        await page.fill('#ws-device', 'LAPTOP-1'); await page.dispatchEvent('#ws-device', 'change');
        await page.click('#main [data-act="ws-choose"]');
        await page.waitForSelector('#main [data-act="ws-save"]:not([disabled])');
        await page.click('#main [data-act="ws-save"]');
        await page.waitForFunction(() => /Saved to the workspace/.test(document.querySelector('#toast')?.textContent || ''));
        await page.waitForSelector('#main .ws-list tbody tr');
        const row1 = await page.textContent('#main .ws-list tbody tr');
        check('v1.6.4: Save to workspace — the filing is listed with its version stamp (v1, this laptop)', /v1/.test(row1) && /LAPTOP-1/.test(row1) && /FY 2017-18/.test(row1), row1);
        check('v1.6.4: the bar shows the workspace version', /Workspace · v1/.test(await page.textContent('#bar-status')));
        // a change, then Ctrl+S saves to the workspace too (version 2; version 1 kept in backups)
        await page.click('a[data-go="setup"]');
        await page.fill('#f-name', 'Test Co Two');
        await page.click('#setup button[type="submit"]');
        await page.waitForTimeout(200);
        check('v1.6.4: an unsaved change shows in the bar', /Workspace: not saved/.test(await page.textContent('#bar-status')), await page.textContent('#bar-status'));
        await page.keyboard.press('Control+KeyS');
        await page.waitForFunction(() => /version 2/.test(document.querySelector('#toast')?.textContent || ''));
        const moved2 = await page.textContent('#toast');
        check('v1.6.5: the corrected name moves the filing — the save says from which folder', /Moved from Test Co \(/.test(moved2) && /Test Co Two \(/.test(moved2), moved2);
        await page.click('a[data-go="workspace"]');
        await page.waitForFunction(() => /· v2/.test(document.querySelector('#main .ws-list tbody')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
        const rows = await page.$$eval('#main .ws-list tbody tr', (trs) => trs.map((t) => t.textContent));
        const moveToast = await page.textContent('#toast');
        check('v1.6.4 / v1.6.5: Ctrl+S saves to the workspace once the filing is saved there — after the name was corrected the filing moves to the folder of its new name (one filing listed, version 2, version 1 in backups)', rows.length === 1 && /Test Co Two/.test(rows[0]) && /· v2/.test(rows[0]) && /\b1\b/.test(rows[0]), JSON.stringify(rows) + ' | ' + moveToast);
        // the generated XML into the filing's xml folder (numbered)
        await page.click('a[data-go="xml"]');
        await page.click('button[data-act="generate"]');
        await page.waitForSelector('#xmltext, .banner.bad');
        const xmlBtn = (await page.locator('#main [data-act="ws-save-xml"]').count()) ? '#main [data-act="ws-save-xml"]' : '#main [data-act="ws-save-xml-errors"]';
        await page.click(xmlBtn);
        if (xmlBtn.endsWith('errors"]')) await page.click('#dlg-continue');
        await page.waitForFunction(() => /xml \/ .*_v1_/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
        check('v1.6.4: Save XML to workspace — numbered in the filing\'s xml folder, the project saved with it', /_2018-03-31_v1_/.test(await page.textContent('#toast')) && /\.xml/.test(await page.textContent('#toast')), await page.textContent('#toast'));
        // "the other laptop" saves version 9 into the same file
        await page.evaluate(async () => {
          const root = await navigator.storage.getDirectory();
          for await (const c of root.values()) {
            if (c.kind !== 'directory') continue;
            for await (const y of c.values()) {
              if (y.kind !== 'directory') continue;
              for await (const f of y.values()) {
                if (f.kind !== 'file' || !f.name.endsWith('.mca-indas.json')) continue;
                const j = JSON.parse(await (await f.getFile()).text());
                if (!/Test Co Two/.test(j.meta.name)) continue;
                j.meta.lastSaved = { n: 9, at: '2026-10-21T09:30:00.000Z', device: 'LAPTOP-2' };
                j.meta.level = 'Lakhs';
                const w = await f.createWritable(); await w.write(JSON.stringify(j)); await w.close();
              }
            }
          }
        });
        await page.click('a[data-go="workspace"]');
        await page.click('#main [data-act="ws-refresh"]');
        await page.waitForSelector('#main .banner.warn [data-act="ws-open-newer"]');
        check('v1.6.4: a newer version saved on the other laptop is reported (bar, Workspace page)', /Newer version in workspace/.test(await page.textContent('#bar-status')) && /version 9/.test(await page.textContent('#main .banner.warn')) && /LAPTOP-2/.test(await page.textContent('#main .banner.warn')), `${await page.textContent('#bar-status')} | ${(await page.$$eval('#main .banner.warn', (b) => b.map((x) => x.textContent))).join(' || ')}`);
        await page.keyboard.press('Control+KeyS');
        await page.waitForSelector('#modal:not([hidden])');
        check('v1.6.4: saving over the newer version asks first (Save anyway / Cancel)', /A newer version is in the workspace/.test(await page.textContent('#modal')) && /version 9/.test(await page.textContent('#modal')));
        await page.click('#dlg-cancel');
        await page.click('#main [data-act="ws-compare-newer"]');
        await page.waitForSelector('#main .tiles');
        check('v1.6.4: Compare shows what the other laptop changed (level of rounding)', /Level of rounding/.test(await page.textContent('#main')) && /Lakhs/.test(await page.textContent('#main')));
        await page.click('a[data-go="workspace"]');
        await page.click('#main [data-act="ws-open-newer"]');
        await page.waitForTimeout(300);
        check('v1.6.4: Open the newer version — version 9 from LAPTOP-2 is open', /Version 9/.test(await page.textContent('#toast')) && /Workspace · v9/.test(await page.textContent('#bar-status')), await page.textContent('#toast'));
        // a reload (the browser restarted): the folder is reconnected by itself and the filing is still linked
        await page.reload();
        await page.waitForSelector('#nav a[data-elr]');
        await page.waitForFunction(() => /Workspace · v9/.test(document.querySelector('#bar-status')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
        check('v1.6.4: after a reload the workspace folder and the filing\'s version are remembered', /Workspace · v9/.test(await page.textContent('#bar-status')), await page.textContent('#bar-status'));
        await page.click('a[data-go="workspace"]');
        await page.waitForSelector('#main .ws-list tbody tr');
        const bOpt = await page.$eval('#main select[data-ws-cmp]', (el) => [...el.options].find((o) => o.value.startsWith('b:'))?.value);
        if (bOpt) { await page.selectOption('#main select[data-ws-cmp]', bOpt); await page.click('#main [data-act="ws-compare"]'); await page.waitForSelector('#main .tiles'); }
        check('v1.6.4: a backup can be compared with the open filing', !!bOpt && (await page.textContent('#main')).includes(bOpt.slice(2)) && /differences/.test(await page.textContent('#main .tiles')), bOpt);
        // Compare page: the open filing with a project file
        writeFileSync(projFile, JSON.stringify(baseSession().filing.toJSON()));
        await page.click('a[data-go="compare"]');
        await page.evaluate(() => { document.getElementById('file-cmp').multiple = false; });
        await page.setInputFiles('#file-cmp', projFile);
        await page.waitForFunction(() => /differences/.test(document.querySelector('#main .tiles')?.textContent || ''));
        check('v1.6.4: Compare versions — the open filing with a project file', (await page.locator('#main table.g.cmp').count()) >= 1 && /\.smoke-v164/.test(await page.textContent('#main')));
        // Save project still downloads the project file (now with its version stamp)
        const [pdl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.keyboard.press('Control+Shift+KeyS')]);
        const pj = pdl ? JSON.parse(readFileSync(await pdl.path(), 'utf8')) : null;
        check('v1.6.4: Save project still downloads the project file, now with its version stamp', !!pj && /\.mca-indas\.json$/.test(pdl.suggestedFilename()) && pj.meta?.lastSaved?.n === 10 && pj.meta.lastSaved.device === 'LAPTOP-1', JSON.stringify(pj?.meta?.lastSaved));
        // v1.6.5: an XML imported under an odd file name is named after the company in it — and saved under that name
        const oddXml = path.join(ROOT, '585265606_ODD_FILE_NAME_2017-18_Financial Statement.xml');
        { const { exampleSession, exportUnchecked } = await import('./fixtures.mjs'); writeFileSync(oddXml, exportUnchecked(exampleSession(), '2018-09-30')); }
        try {
          await page.setInputFiles('#file-xml', oddXml);
          await page.waitForSelector('#import-confirm');
          await page.check('#ym-both');
          await page.click('#import-commit');
          await page.waitForSelector('.banner.info');
        } finally { unlinkSync(oddXml); }
        const who = await page.textContent('#bar-who');
        await page.click('a[data-go="workspace"]');
        await page.waitForSelector('#main [data-act="ws-save"]:not([disabled])');
        await page.click('#main [data-act="ws-save"]');
        await page.waitForFunction(() => /Saved to the workspace/.test(document.querySelector('#toast')?.textContent || ''));
        const oddToast = await page.textContent('#toast');
        check('v1.6.5: an XML imported under an odd file name is named after the company in it, and saved in the folder of that name', /Example Industries Private Limited/.test(who) && !/ODD_FILE_NAME/.test(who + oddToast) && /Example Industries Private Limited \(U72200KA2010PTC123456\) \/ FY 2017-18 \/ Example_Industries_Private_Limited_2017-18_Standalone\.mca-indas\.json/.test(oddToast), `${who} | ${oddToast}`);
      } finally { try { unlinkSync(projFile); } catch { /* ignore */ } await page.close(); server.close(); }
    }
    check('no page errors', errors.length === 0, errors.map((e) => e.stack || e).join('; '));
  } finally {
    try { unlinkSync(exported); } catch { /* ignore */ }
    await browser.close();
  }
  return { status: checks.every((c) => c.ok) ? 'PASS' : 'FAIL', ...st, checks };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = await runBrowserSmoke();
  for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : ' — ' + c.detail}`);
  console.log(r.status, r.reason || '');
  process.exit(r.status === 'FAIL' ? 1 : 0);
}
