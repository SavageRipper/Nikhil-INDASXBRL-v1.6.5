// v1.6.5 (C&I v15.3 ported): a filing is named after its company, not after the XML file it was imported from
// (workspace folders such as "585265606_…_Financial Statement (CIN)" or "…_2026-03-31 (6) (CIN)"); a renamed filing
// moves to its new folder; a failed save names the folder or file; names are kept short (Windows limits a path to 260
// characters). Synthetic data, plus the reference instances when present.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { authority } from './helpers.mjs';
import { Session } from './session.js';
import { Filing } from './model.js';
import { healthCheck } from './upkeep.js';
import { exampleSession, exportUnchecked } from './fixtures.mjs';
import { projectPath, saveToWorkspace, saveXmlToWorkspace, listWorkspace, filingKey } from './workspace.js';

const A = authority();
const today = '2018-09-30';
class MemDir {
  constructor(name = 'root') { this.kind = 'directory'; this.name = name; this.entries = new Map(); }
  async getDirectoryHandle(n, { create = false } = {}) {
    if (this.failNext) { this.failNext--; throw Object.assign(new Error('A requested file or directory could not be found at the time an operation was processed.'), { name: 'NotFoundError' }); }
    let e = this.entries.get(n);
    if (!e) { if (!create) throw Object.assign(new Error('NotFound'), { name: 'NotFoundError' }); e = new MemDir(n); this.entries.set(n, e); }
    return e;
  }
  async getFileHandle(n, { create = false } = {}) {
    let e = this.entries.get(n);
    if (!e) { if (!create) throw Object.assign(new Error('NotFound'), { name: 'NotFoundError' }); e = { kind: 'file', name: n, data: '', async getFile() { const d = this.data; return { text: async () => d }; }, async createWritable() { let b = ''; const f = this; return { write: async (t) => { b += t; }, close: async () => { f.data = b; } }; } }; this.entries.set(n, e); }
    return e;
  }
  async *values() { for (const e of this.entries.values()) yield e; }
  async removeEntry(n) { if (!this.entries.delete(n)) throw new Error('NotFound'); }
}
// as the company page's Apply: the filing's name and the Name of company element
const example = (name = 'Example Traders Private Limited') => { const s = exampleSession(); s.setMeta({ name, cin: 'U99999MH2000PTC999999' }); s.setValue(A.qnameOfLocal('NameOfCompany'), 'CY', name); return s; };

test('an imported XML is named after the company in it (Name of company), not after the file — both years and next year\'s filing', () => {
  const s = example('Example Traders Private Limited');
  const xml = exportUnchecked(s, today);
  for (const yearMode of ['both', 'next']) {
    const t = new Session(A);
    t.importXml(xml, { DOMParserImpl: DOMParser, fileName: '585265606_SOME_COMPANY_2017-18_Financial Statement.xml', yearMode, cashFlowMethod: 'Indirect Method' });
    assert.equal(t.filing.meta.name, 'Example Traders Private Limited', yearMode);
    assert.equal(projectPath(t.filing.meta).company, 'Example Traders Private Limited (U99999MH2000PTC999999)', yearMode);
  }
  for (const f of ['golden-ref-a-2022-23.xml', 'golden-ref-b-2024-25.xml', 'golden-ref-c-standalone-2024-25.xml'].filter((x) => existsSync(x))) {
    const u = new Session(A); u.importXml(readFileSync(f, 'utf8'), { DOMParserImpl: DOMParser, fileName: 'U00000XX0000PTC000000_Standalone_2026-03-31 (6).xml' });
    assert.equal(u.filing.meta.name, String(u.filing.value(A.qnameOfLocal('NameOfCompany'), 'CY', [])).replace(/\s+/g, ' ').trim(), f);
  }
});

test('a project saved under the file name takes the company name on opening (health check, once); the XML is unchanged', () => {
  const s = example('Example Traders Private Limited');
  const xml0 = exportUnchecked(s, today);
  const json = JSON.parse(JSON.stringify(s.filing.toJSON())); json.meta.name = 'U99999MH2000PTC999999_Standalone_2018-03-31 (6)';
  const S = new Session(A, Filing.fromJSON(A, json));
  const h = healthCheck(S);
  assert.deepEqual(h.name, { before: 'U99999MH2000PTC999999_Standalone_2018-03-31 (6)', after: 'Example Traders Private Limited' });
  assert.ok(h.changed >= 1);
  assert.equal(S.filing.meta.name, 'Example Traders Private Limited');
  assert.equal(healthCheck(S).name, null, 'once');
  assert.equal(exportUnchecked(S, today), xml0);
  // a project whose name already is the company's: nothing to do
  assert.equal(healthCheck(new Session(A, Filing.fromJSON(A, s.filing.toJSON()))).name, null);
});

test('long names are cut at a word — the whole path stays well inside the Windows limit', () => {
  const long = 'Example Very Long Industries And Trading Company Of Northern India Private Limited Financial Statement';
  const p = projectPath({ name: long, cin: 'U99999MH2000PTC999999', reportType: 'Consolidated', periods: { cy: { start: '2025-04-01', end: '2026-03-31' } } });
  assert.ok(p.company.length <= 60 + 24, p.company);
  assert.ok(!/ $|\.$/.test(p.company.replace(/ \(.*\)$/, '')));
  const backup = `${p.base}_2026-10-22_1015_v12.mca-indas.json`;
  const path = ['G:\\My Drive\\XBRL', p.company, p.year, 'backups', backup].join('\\');
  assert.ok(path.length < 220, `${path.length}: ${path}`);
  assert.equal(projectPath({ name: 'Short Co Ltd', cin: 'U99999MH2000PTC999999', reportType: 'Standalone', periods: { cy: { start: '2025-04-01', end: '2026-03-31' } } }).company, 'Short Co Ltd (U99999MH2000PTC999999)', 'short names unchanged');
});

test('moving a renamed filing leaves the other report type\'s files in the old folder alone', async () => {
  const root = new MemDir();
  const sa = example('Old Name Ltd');
  const co = example('Old Name Ltd'); co.setMeta({ reportType: 'Consolidated' });
  const at = (h) => new Date(2026, 9, 22, h);
  const r1 = await saveToWorkspace(root, sa.filing.toJSON(), { now: at(9) });
  await saveXmlToWorkspace(root, sa.filing.toJSON(), '<xml/>', { now: at(9) });
  await saveToWorkspace(root, co.filing.toJSON(), { now: at(9) });
  await saveXmlToWorkspace(root, co.filing.toJSON(), '<xml/>', { now: at(9) });
  sa.filing.meta.lastSaved = r1.lastSaved;
  sa.setMeta({ name: 'New Name Ltd' }); sa.setValue(A.qnameOfLocal('NameOfCompany'), 'CY', 'New Name Ltd');
  const r2 = await saveToWorkspace(root, sa.filing.toJSON(), { base: r1.lastSaved, link: { folder: r1.path.folder, file: r1.path.file, key: filingKey(sa.filing.meta) }, now: at(10) });
  assert.deepEqual(r2.moved.left, []);
  const list = await listWorkspace(root);
  const by = Object.fromEntries(list.map((x) => [`${x.name} ${x.reportType}`, [x.xml.length, x.backups.length]]));
  assert.deepEqual(by, { 'New Name Ltd Standalone': [1, 2], 'Old Name Ltd Consolidated': [1, 1] });
});

test('a failed save names the folder; a passing failure is tried once more', async () => {
  const root = new MemDir();
  const s = example();
  root.failNext = 1;
  const r = await saveToWorkspace(root, s.filing.toJSON(), { now: new Date(2026, 9, 22, 9) });
  assert.equal(r.status, 'saved', 'retried');
  root.failNext = 5;
  await assert.rejects(saveToWorkspace(root, s.filing.toJSON(), { now: new Date(2026, 9, 22, 10) }), (e) => e.name === 'NotFoundError' && /^folder Example Traders Private Limited \(U99999MH2000PTC999999\) \/ FY 2017-18: A requested file/.test(e.message));
});
