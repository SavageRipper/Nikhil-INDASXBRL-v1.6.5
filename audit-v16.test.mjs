// v1.6: the taxonomy the MCA validator downloads (Taxonomy-2017-03-31.zip) in place of the package published on the MCA
// website — two-letter SRNs and the corrected biological-assets-at-cost roll-forward; the XML on request in spite of
// internal errors (Generate XML page). Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { authority, q } from './helpers.mjs';
import { baseSession, runRule, exportUnchecked } from './fixtures.mjs';
import { ensureTaxonomy, TAXONOMY_ZIP_NAME, ENTRY_POINT } from './taxonomy-source.mjs';

const A = authority();
const today = '2018-09-30';
// SRN of form ADT-1 is reported per auditor (Details regarding auditors [Table], typed axis)
const AUD = { tid: '700400a:DetailsRegardingAuditorsTable', dims: [{ axis: q('AuditorsAxis'), typed: 'Auditor1' }] };
const putSrn = (s, v) => s.filing.setFact({ concept: q('SRNOfFormADT1'), period: s.filing.period(q('SRNOfFormADT1'), 'CY'), dims: AUD.dims, value: v, origin: 'user' });

test('taxonomy package: the validator\'s zip (files at its root) is extracted with the entry point at the taxonomy root, and re-extracted when the zip changes', () => {
  assert.equal(TAXONOMY_ZIP_NAME, 'Taxonomy-2017-03-31.zip');
  const root = ensureTaxonomy();
  assert.ok(existsSync(path.join(root, ENTRY_POINT)));
  assert.ok(existsSync(path.join(root, 'in-ca', 'in-ca-types-2017-03-31.xsd')));
  assert.match(readFileSync(path.join(root, '.source-sha256'), 'utf8'), /^[0-9a-f]{64}$/);
  assert.ok(A.meta.sources.some((s) => s.file === 'Taxonomy-2017-03-31.zip'));
  assert.ok(!A.meta.sources.some((s) => /Taxonomy_for_IND-AS/.test(s.file)), 'the published package is no longer a source');
});

test('SRN (SRN of form ADT-1, SRN of the subsidiary\'s balance-sheet filing): one letter + 8 digits or two letters + 7 digits', () => {
  assert.deepEqual(A.json.types['in-ca-types:SRNNumber'].pattern, '(?:[A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9])|(?:[A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9])');
  const SRN = q('SRNOfFormADT1');
  assert.ok(SRN);
  const check = (v) => { const s = baseSession(); putSrn(s, v); return s.validate({ today }).issues.filter((i) => i.code === 'value.pattern' || i.code === 'value.length').map((i) => i.code); };
  assert.deepEqual(check('A12345678'), [], 'old format');
  assert.deepEqual(check('AB1234567'), [], 'new MCA V3 format');
  assert.deepEqual(check('ABC123456'), ['value.pattern'], 'three letters');
  assert.deepEqual(check('ab1234567'), ['value.pattern'], 'lower case');
  assert.ok(check('AB123456').includes('value.length'), 'eight characters');
});

test('biological assets at cost: the roll-forward the published taxonomy could not evaluate is checked and filled in (opening + changes = closing)', () => {
  const TID = '401000a:DisclosureOfReconciliationOfChangesInBiologicalAssetsOtherThanBearerPlantsAtCostTable';
  const dims = [{ axis: q('TypeOfBiologicalAssetsOtherThanBearerPlantsAtCostAxis'), typed: 'One' }];
  const BAL = q('BiologicalAssetsOtherThanBearerPlantsAtCost'), ADD = q('AdditionsOtherThanThroughBusinessCombinationsBiologicalAssetsOtherThanBearerPlantsAtCost');
  const CHG = q('ChangesInBiologicalAssetsOtherThanBearerPlantsAtCost');
  const s = baseSession();
  s.filing.setFact({ concept: BAL, period: s.filing.period(BAL, 'PY'), dims, value: '1000', origin: 'user' });
  s.setTableValue(TID, 'CY', dims, ADD, '250', { recalc: true });
  assert.equal(s.filing.value(CHG, 'CY', dims), '250', 'the change is the total of its parts');
  assert.equal(s.filing.value(BAL, 'CY', dims), '1250', 'closing derived from opening + change');
  const ok = runRule(s, 'FX-BiologicalAssetsOtherThanBearerPlantsAtCost', { scope: 'CY' });
  assert.ok(ok.pass && !ok.fail, JSON.stringify(ok.res));
  s.setTableValue(TID, 'CY', dims, BAL, '1300', { recalc: true }); // a closing typed that does not agree
  const bad = runRule(s, 'FX-BiologicalAssetsOtherThanBearerPlantsAtCost', { scope: 'CY' });
  assert.ok(bad.res.some((x) => x.status === 'FAIL' && /opening 1000 \+ change 250 = 1250 ≠ closing 1300/.test(x.message)), JSON.stringify(bad.res));
});

test('Generate XML with errors: refused by default; on request the same XML, marked as not validated', () => {
  const s = baseSession();
  putSrn(s, 'ABC123456'); // an error of the internal gate
  assert.throws(() => s.exportXml({ today }), /Internal validation gate blocked XML generation/);
  const { xml, gate, unchecked } = s.exportXml({ today, allowErrors: true });
  assert.equal(unchecked, true);
  assert.ok(!gate.ok && gate.summary.errors >= 1);
  assert.match(xml, /^<\?xml[^>]*\?>\n<!-- NOT VALIDATED: generated with \d+ unresolved internal validation error\(s\)/);
  assert.equal(xml.replace(/\n<!-- NOT VALIDATED:[^>]*-->/, ''), exportUnchecked(s, today), 'otherwise the XML the gate would have produced');
  const fine = baseSession();
  const r = fine.exportXml({ today, allowErrors: true });
  assert.equal(r.unchecked, false);
  assert.ok(!/NOT VALIDATED/.test(r.xml), 'no mark when there is no error');
});
