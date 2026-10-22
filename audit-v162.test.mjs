// v1.6.2: names / identifiers kept out of a table's TOTAL column; footnotes with tables (rich text) in the preview;
// a table-level border class kept on its cells. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { authority, q, importSession } from './helpers.mjs';
import { exampleSession } from './fixtures.mjs';
import { identityItem, totalColumnAllowed, nondimRowElrs } from './views.js';
import { fixFor } from './fixes.js';
import { fromMca, toMca, footnoteText, footnoteEditorHtml } from './richtext.js';
import { buildPreviewHtml } from './pdf-preview.js';
import { addFootnote } from './footnotes.js';

const A = authority();
const today = '2018-09-30';
const T = '400100a:DisclosureOfShareholdingMoreThanFivePerCentInCompanyTable';

test('identity elements: names and identifiers of list members, never the elements MCA-validated filings report in total columns', () => {
  for (const x of ['NameOfShareholder', 'PermanentAccountNumberOfShareholder', 'CINOfShareholder', 'CountryOfIncorporationOrResidenceOfShareholder', 'NameOfRelatedParty', 'NameOfMainProductOrService']) assert.ok(identityItem(A, q(x)), x);
  for (const x of ['DepreciationMethodPropertyPlantAndEquipment', 'UsefulLivesOrDepreciationRatesPropertyPlantAndEquipment', 'WhetherPropertyPlantAndEquipmentAreStatedAtRevaluedAmount', 'AmortisationMethodOtherIntangibleAssets', 'ModeOfValuation', 'TypeOfShare', 'NumberOfSharesHeldInCompany', 'ValueOfSharesPaidUp']) assert.ok(!identityItem(A, q(x)), x);
  assert.ok(totalColumnAllowed(A, T));
  // no identity element has a row of its own on a tab (the guard only concerns table total columns)
  const rows = nondimRowElrs(A);
  assert.ok(!['NameOfShareholder', 'NameOfRelatedParty'].some((x) => rows.has(q(x))));
});

test('TOTAL column: a name cannot be typed there; one already there (imported / older project) is a warning with "Clear it"', () => {
  const s = exampleSession();
  for (const sc of ['CY', 'PY']) s.setValue(q('WhetherThereAreAnyShareholdersHoldingMoreThanFivePerCentSharesInCompany'), sc, 'true');
  assert.throws(() => s.setTableValue(T, 'CY', [], q('NameOfShareholder'), 'NA'), /names a single member/);
  // numbers stay possible in the total column (the guard is for names / identifiers only)
  const n = s.setTableValue(T, 'CY', [], q('NumberOfSharesHeldInCompany'), '100');
  assert.equal(n.value, '100');
  s.filing.removeFact(n.key);
  // a name already in the total column (as in a project of an earlier version)
  s.filing.setFact({ concept: q('NameOfShareholder'), period: s.filing.period(q('NameOfShareholder'), 'CY'), dims: [], value: 'NA', lang: 'en', origin: 'user' });
  const w = s.validate({ today }).issues.find((i) => i.code === 'total.identity');
  assert.ok(w && w.severity === 'WARNING', 'a warning, not an error');
  assert.match(w.message, /Name of shareholder 'NA' is in the TOTAL column/i);
  const fx = fixFor(s, w);
  assert.equal(fx.label, 'Clear it');
  fx.apply();
  assert.equal(s.filing.value(q('NameOfShareholder'), 'CY', []), null);
  assert.ok(!s.validate({ today }).issues.some((i) => i.code === 'total.identity'));
  // clearing is always possible
  s.filing.setFact({ concept: q('NameOfShareholder'), period: s.filing.period(q('NameOfShareholder'), 'CY'), dims: [], value: 'NA', lang: 'en', origin: 'user' });
  assert.equal(s.setTableValue(T, 'CY', [], q('NameOfShareholder'), ''), null);
});

test('MCA-validated filings: no name or identifier in any total column (the guard blocks nothing they report)', { skip: !existsSync('golden-ref-c-standalone-2024-25.xml') && 'golden files not present' }, () => {
  for (const g of ['golden-ref-a-2022-23.xml', 'golden-ref-b-2024-25.xml', 'golden-ref-c-standalone-2024-25.xml', 'golden-ref-c-consolidated-2024-25.xml']) {
    if (!existsSync(g)) continue;
    const { s } = importSession(readFileSync(g, 'utf8'));
    assert.deepEqual(s.validate({ today: '2025-09-30' }).issues.filter((i) => i.code === 'total.identity').map((i) => i.message), [], g);
  }
});

test('a table-level border class (footnotes of MCA-validated filings) is kept on the cells', () => {
  const src = '<span>\n<table class="bordered">\n<tr>\n<td>\n<p><span>3(b)</span></p>\n</td>\n<td>Capital work-in-progress</td>\n</tr>\n</table>\n</span>';
  const ed = fromMca(src);
  assert.match(ed, /<td class="bordered">3\(b\)<\/td><td class="bordered">Capital work-in-progress<\/td>/);
  assert.match(toMca(ed), /<td class="bordered">3\(b\)<\/td>/);
  assert.match(fromMca('<table><tr><td>A</td></tr></table>'), /<td>A<\/td>/, 'no border class: none added');
});

test('preview PDF: a footnote with a table is drawn as a table; a plain footnote stays text', () => {
  const s = exampleSession();
  const f = [...s.filing.facts.values()].find((x) => !x.nil && !x.dims.length && A.dataType(x.concept) === 'monetary' && x.value !== '0');
  addFootnote(s.filing, '<table><tbody><tr><td class="bordered">Right of use assets</td><td class="bordered">1,789.07</td></tr></tbody></table>', [f.key]);
  const html = buildPreviewHtml(s, { build: 'test' });
  assert.match(html, /<div class="fns">[\s\S]*<div class="mca"><table><tbody><tr><td class="bordered">Right of use assets<\/td>/);
  const t = exampleSession();
  const g = [...t.filing.facts.values()].find((x) => !x.nil && !x.dims.length && A.dataType(x.concept) === 'monetary' && x.value !== '0');
  addFootnote(t.filing, 'Plain note & more', [g.key]);
  assert.match(buildPreviewHtml(t, { build: 'test' }), /\(A\) Plain note &amp; more/);
});

test('footnotes in the rich-text editor: plain text stays plain text; a table is kept in the MCA subset; both open again', () => {
  for (const t of ['Smoke footnote', 'Line one\nLine two', 'A & B < C']) assert.equal(footnoteText(footnoteEditorHtml(t)), t, t);
  const imported = '<span>\n<table class="bordered">\n<tr>\n<td>Right of use assets</td>\n<td>1,789.07</td>\n</tr>\n</table>\n</span>';
  const saved = footnoteText(footnoteEditorHtml(imported));
  assert.equal(saved, '<table><tbody><tr><td class="bordered">Right of use assets</td><td class="bordered">1,789.07</td></tr></tbody></table>');
  assert.equal(footnoteText(footnoteEditorHtml(saved)), saved, 'stable');
  assert.equal(footnoteText('<p><br></p>'), '', 'empty');
  assert.match(footnoteText('<p><b>Note</b> text</p>', { emphasis: 'highlight' }), /highlightedText1/);
});
