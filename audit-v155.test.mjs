// v1.5.5: MCA validator "All mandatory elements for table DisclosureOfDetailsOfSubsidiariesTable must be present for
// atleast one context as on <year end>" — the table name is used in [611500] and [613400]; the MCA validator checks the
// mandatory elements of both together, so at least one member must carry both lists (the MCA-validated consolidated
// filing used the same member in both tables). Also (since v1.5.4) a count in no family keeps the unit the filing
// already uses for it. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { authority, q } from './helpers.mjs';
import { baseSession, consolidatedSession, runRule, placeholder } from './fixtures.mjs';
import { sharedNameTables } from './rules.js';
import { fixFor } from './fixes.js';

const A = authority();
const T1 = '611500:DisclosureOfDetailsOfSubsidiariesTable', T2 = '613400:DisclosureOfDetailsOfSubsidiariesTable';
const AXIS = q('SignificantInvestmentsInSubsidiariesAxis');
const row = (v) => [{ axis: AXIS, typed: v }];
const rule = (id) => A.rules.rules.find((r) => r.id === id);
const LIST1 = rule('ML-105').ast.concepts, LIST2 = rule('ML-104').ast.concepts;

function fill(s, member, concepts, names = {}, scope = 'CY') {
  for (const c of concepts) {
    const local = c.split(':')[1];
    const value = names[local] ?? (A.isNumeric(c) ? (A.dataType(c) === 'percent' ? '1' : '0') : placeholder(A, c));
    s.filing.setFact({ concept: c, period: s.filing.period(c, scope), dims: row(member), value, lang: A.isNumeric(c) || !A.langAllowed(c) ? null : 'en', origin: 'user' });
  }
}
// a consolidated filing with two subsidiaries: [611500] rows One / Two, [613400] rows as given
function filing(members613400) {
  const s = consolidatedSession();
  s.setValue(q('WhetherCompanyHasSubsidiaryCompanies'), 'CY', 'true');
  s.setValue(q('NumberOfSubsidiaryCompanies'), 'CY', '2');
  fill(s, 'One', LIST1, { NameOfSubsidiary: 'Alpha Inc' });
  fill(s, 'Two', LIST1, { NameOfSubsidiary: 'Beta Trading LLC' });
  fill(s, members613400[0], LIST2, { NameOfSubsidiaryConsolidated: 'ALPHA INC.' });
  fill(s, members613400[1], LIST2, { NameOfSubsidiaryConsolidated: 'Beta Trading LLC' });
  return s;
}
const shared = (s, scope = 'CY') => runRule(s, 'ML-105', { scope }).res.filter((x) => /under the same name|carries the mandatory elements of/.test(x.message));

test('tables of one name with their own mandatory lists: subsidiaries, associates, joint ventures', () => {
  const g = sharedNameTables(A);
  assert.deepEqual(g.map((x) => [x.tables.map((t) => t.split(':')[0]), x.reporter]), [[['611400', '611500h'], 'ML-78'], [['611400b', '611500d'], 'ML-84'], [['611500', '613400'], 'ML-105']]);
  // blocking for the subsidiaries (MCA validator evidence, GOLDEN_CALIBRATION.json); a warning for the others
  assert.deepEqual(g.map((x) => x.severity), ['WARNING', 'WARNING', 'ERROR']);
  const sub = g.find((x) => x.tables.includes(T1));
  assert.deepEqual(sub.concepts.get(T1), LIST1);
  assert.deepEqual(sub.concepts.get(T2), LIST2);
});

test('the reported case: each table complete, but under different members (One / Subsidiary1) — blocking, with a one-click fix', () => {
  const s = filing(['Subsidiary1', 'Subsidiary2']);
  // each table on its own is complete
  assert.ok(!runRule(s, 'ML-104', { scope: 'CY' }).statuses.includes('FAIL'));
  const res = shared(s);
  assert.equal(res.length, 1);
  assert.equal(res[0].status, 'FAIL');
  assert.match(res[0].message, /in \[611500\] and \[613400\] under the same name.*No member is used in both tables: \[611500\] One, Two · \[613400\] Subsidiary1, Subsidiary2/);
  assert.equal(res[0].tableId, T2, 'leads to the table whose rows to rename');
  const issue = s.validate({ today: '2026-10-15' }).issues.find((i) => i.severity === 'ERROR' && /under the same name/.test(i.message));
  assert.ok(issue, 'a gate error');
  const fx = fixFor(s, issue);
  assert.ok(fx && /Subsidiary1<\/b> → <b>One/.test(fx.confirm) && /Subsidiary2<\/b> → <b>Two/.test(fx.confirm), fx?.confirm);
  fx.apply();
  assert.equal(shared(s)[0].status, 'PASS');
  assert.equal(s.filing.value(q('NameOfSubsidiaryConsolidated'), 'CY', row('One')), 'ALPHA INC.', 'values moved with the member');
  assert.ok(!s.validate({ today: '2026-10-15' }).issues.some((i) => i.severity === 'ERROR' && /ML-10[45]/.test(i.ruleId)));
});

test('same member in both tables (as the MCA-validated consolidated filing): passes; an element missing on it is named', () => {
  const s = filing(['One', 'Two']);
  assert.equal(shared(s)[0].status, 'PASS');
  for (const m of ['One', 'Two']) s.filing.removeFact(s.filing.get(q('PrincipalPlaceOfBusinessOfSubsidiaryConsolidated'), s.filing.period(q('PrincipalPlaceOfBusinessOfSubsidiaryConsolidated'), 'CY'), row(m)).key);
  const res = shared(s);
  assert.equal(res[0].status, 'FAIL');
  assert.match(res[0].message, /lacks PrincipalPlaceOfBusinessOfSubsidiaryConsolidated \[613400\]/);
});

test('associates in [611400b] and [611500d] under different members: a warning, not blocking', () => {
  const s = consolidatedSession();
  s.setValue(q('WhetherCompanyHasInvestedInAssociates'), 'CY', 'true');
  const ax = q('SignificantInvestmentsInAssociatesAxis');
  const put = (tid, member, list) => { for (const c of list) s.filing.setFact({ concept: c, period: s.filing.period(c, 'CY'), dims: [{ axis: ax, typed: member }], value: A.isNumeric(c) ? (A.dataType(c) === 'percent' ? '1' : '0') : placeholder(A, c), lang: A.isNumeric(c) || !A.langAllowed(c) ? null : 'en', origin: 'user' }); };
  put('611400b', 'One', rule('ML-84').ast.concepts);
  put('611500d', 'Associate1', rule('ML-83').ast.concepts.filter((c) => !rule('ML-84').ast.concepts.includes(c)));
  const res = runRule(s, 'ML-84', { scope: 'CY' }).res.filter((x) => /under the same name/.test(x.message));
  assert.ok(res.length && res.every((x) => x.status === 'WARN') && /not yet confirmed/.test(res[0].message), res.map((x) => x.status + ' ' + x.message).join('\n'));
});

test('previous year: [613400] is not reported, so only the [611500] list applies (no combined check)', () => {
  const s = filing(['Subsidiary1', 'Subsidiary2']);
  s.setValue(q('WhetherCompanyHasSubsidiaryCompanies'), 'PY', 'true');
  fill(s, 'One', LIST1, { NameOfSubsidiary: 'Alpha Inc' }, 'PY');
  assert.deepEqual(shared(s, 'PY'), []);
});

test('standalone filing: [613400] has no rows — nothing combined', () => {
  const s = baseSession();
  s.setValue(q('WhetherCompanyHasSubsidiaryCompanies'), 'CY', 'true');
  fill(s, 'One', LIST1, { NameOfSubsidiary: 'Alpha Inc' });
  assert.deepEqual(shared(s), []);
});

test('a new row of [613400] suggests the [611500] member not yet used there', () => {
  const s = filing(['One', 'Subsidiary9']);
  assert.equal(s.suggestTypedValue(T2, 'CY', AXIS), 'Two');
  const t = consolidatedSession();
  assert.match(t.suggestTypedValue(T2, 'CY', AXIS), /\d$/, 'nothing in [611500]: the usual sequential name');
});

test('the fix leaves a row alone when the name does not match or the member is taken', () => {
  const s = filing(['Subsidiary1', 'Subsidiary2']);
  s.filing.setFact({ concept: q('NameOfSubsidiaryConsolidated'), period: s.filing.period(q('NameOfSubsidiaryConsolidated'), 'CY'), dims: row('Subsidiary2'), value: 'Gamma Ltd', lang: 'en', origin: 'user' });
  assert.deepEqual(s.alignSharedMembers('CY').map((x) => [x.from, x.to]), [['Subsidiary1', 'One']]);
});

test('units: a count in no family keeps the unit the filing uses for it (last year imported in INR → this year INR)', () => {
  const s = baseSession();
  const N = q('NumberOfSubsidiaryCompanies');
  assert.equal(s.filing.unitFor(N), 'pure', 'nothing reported: the default');
  s.setValue(q('WhetherCompanyHasSubsidiaryCompanies'), 'CY', 'true');
  s.filing.setFact({ concept: N, period: s.filing.period(N, 'PY'), value: '1', decimals: 'INF', unit: 'INR', origin: 'import' });
  assert.equal(s.filing.unitFor(N), 'INR');
  assert.equal(s.setValue(N, 'CY', '2').unit, 'INR');
  // a project saved earlier (this year in pure): the health check puts it into last year's unit
  s.filing.get(N, s.filing.period(N, 'CY')).unit = 'pure';
  const changed = s.filing.harmonizeUnits();
  assert.deepEqual(changed.map((x) => [x.concept, x.before, x.after]), [[N, 'pure', 'INR']]);
  assert.equal(s.getValue(N, 'CY').value, '2');
  assert.deepEqual(s.filing.harmonizeUnits(), []);
});
