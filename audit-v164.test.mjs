// v1.6.4 (C&I v14.5 ported): [700400] auditor's report — each mandatory clause (ML-52) is required once, under any one
// member of the outcome axis (SR-L6448-1 allows a clause under one member only):
//  (a) the required outline: a clause given under one member is no longer asked for in the other columns;
//  (b) a clause given under no member is one ML-52 message (not one per column), located in the main column;
//  (c) SR-L6448-1 opens the table and offers "Keep it under one member" (the user chooses the member).
// Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { authority, q } from './helpers.mjs';
import { Session } from './session.js';
import { fixFor } from './fixes.js';
import { outcomeTable, outcomeClauseOpen } from './rules.js';

const A = authority();
const today = '2025-10-05';
const AUD = '700400:DisclosureOfAuditorsQualificationsReservationsOrAdverseRemarksInAuditorsReportTable';
const AX = q('AuditorsQualificationsReservationsOrAdverseRemarksInAuditorsReportAxis');
const col = (m) => [{ axis: AX, member: q(m) }];
const FAV = col('AuditorsFavourableRemarkMember'), UNF = col('AuditorsUnfavourableRemarkMember'), NA = col('ClauseNotApplicableMember');
const ML52 = A.rules.rules.find((r) => r.id === 'ML-52').ast.concepts;
const text = (c) => (A.dataType(c) === 'textBlock' ? '<p>Clause complied with.</p>' : 'Clause complied with.');

function auditorSession() {
  const s = new Session(A);
  s.setMeta({ name: 'Test Co', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', level: 'Actual', displayPlaces: 0,
    periods: { cy: { start: '2024-04-01', end: '2025-03-31' }, py: { start: '2023-04-01', end: '2024-03-31' } } });
  s.setValue(q('WhetherCompaniesAuditorsReportOrderIsApplicableOnCompany'), 'CY', 'true');
  for (const c of ML52) s.setTableValue(AUD, 'CY', FAV, c, text(c));
  return s;
}
const issues = (s, id) => s.validate({ today }).issues.filter((i) => i.ruleId === id && i.scope === 'CY');

test('the auditor\'s-report table is the one table on an outcome axis', () => {
  assert.ok(outcomeTable(A, AUD));
  assert.equal(A.tables.filter((t) => outcomeTable(A, t.id)).map((t) => t.id).join(), AUD);
  assert.ok(!outcomeTable(A, '700400a:DetailsRegardingAuditorsTable'));
});

test('(a) required outline: a clause given under one member is not asked for in the other columns; the cell that holds it, and a clause given nowhere, stay outlined', () => {
  const s = auditorSession();
  const inv = q('DisclosureInAuditorsReportRelatingToInventories'), loans = q('DisclosureInAuditorsReportRelatingToLoans');
  s.setTableValue(AUD, 'CY', FAV, inv, '');
  s.setTableValue(AUD, 'CY', UNF, inv, 'Physical verification not conducted.');
  assert.equal(issues(s, 'ML-52').filter((i) => i.severity === 'ERROR').length, 0);
  assert.equal(issues(s, 'SR-L6448-1').filter((i) => i.severity === 'ERROR').length, 0);
  assert.equal(outcomeClauseOpen(A, s.filing, AUD, loans, 'CY', UNF), false, 'given under Favourable: not asked for under Unfavourable');
  assert.equal(outcomeClauseOpen(A, s.filing, AUD, loans, 'CY', NA), false);
  assert.equal(outcomeClauseOpen(A, s.filing, AUD, loans, 'CY', FAV), true, 'the cell that holds it');
  assert.equal(outcomeClauseOpen(A, s.filing, AUD, inv, 'CY', FAV), false, 'moved to Unfavourable');
  assert.equal(outcomeClauseOpen(A, s.filing, AUD, loans, 'PY', UNF), true, 'the other year is on its own');
  s.setTableValue(AUD, 'CY', FAV, loans, '');
  assert.equal(outcomeClauseOpen(A, s.filing, AUD, loans, 'CY', UNF), true, 'given nowhere: outlined in every column');
  assert.equal(outcomeClauseOpen(A, s.filing, '700400a:DetailsRegardingAuditorsTable', q('NameOfAuditFirm'), 'CY', []), true, 'other tables: unchanged');
});

test('(b) a clause given under no member is one ML-52 message (not one per column), located in the main column', () => {
  const s = auditorSession();
  const inv = q('DisclosureInAuditorsReportRelatingToInventories'), fa = q('DisclosureInAuditorsReportRelatingToFixedAssets');
  s.setTableValue(AUD, 'CY', FAV, inv, '');
  s.setTableValue(AUD, 'CY', NA, inv, 'Not applicable.');
  s.setTableValue(AUD, 'CY', FAV, fa, '');
  const e = issues(s, 'ML-52');
  assert.equal(e.length, 1, e.map((i) => i.message).join('\n'));
  assert.equal(e[0].severity, 'ERROR');
  assert.match(e[0].message, /\[Disclosure in auditors report relating to fixed assets|DisclosureInAuditorsReportRelatingToFixedAssets/i);
  assert.match(e[0].message, /not present under any member for CY \(each is required once, under one member\)/);
  assert.equal(e[0].location?.tableId, AUD, 'opens the auditor\'s-report table');
  assert.equal(e[0].concept, fa);
  assert.deepEqual(e[0].dims, FAV, 'the column where most clauses are given');
  s.setTableValue(AUD, 'CY', UNF, fa, 'Records not maintained.');
  assert.equal(issues(s, 'ML-52').length, 0);
});

test('(c) SR-L6448-1: a clause under two members opens the table; "Keep it under one member" keeps the member chosen', () => {
  const s = auditorSession();
  const loans = q('DisclosureInAuditorsReportRelatingToLoans');
  s.setTableValue(AUD, 'CY', UNF, loans, 'Terms prejudicial.');
  const e = issues(s, 'SR-L6448-1').filter((i) => i.severity === 'ERROR');
  assert.equal(e.length, 1);
  assert.equal(e[0].location?.tableId, AUD);
  assert.equal(e[0].concept, loans);
  const fx = fixFor(s, e[0]);
  assert.equal(fx.label, 'Keep it under one member');
  assert.equal(fx.choose[0].options.length, 2);
  const keep = fx.choose[0].options.findIndex((o) => /unfavourable/i.test(o.label));
  assert.ok(keep >= 0, fx.choose[0].options.map((o) => o.label).join(' / '));
  fx.apply([String(keep)]);
  assert.equal(issues(s, 'SR-L6448-1').filter((i) => i.severity === 'ERROR').length, 0);
  assert.equal(issues(s, 'ML-52').length, 0);
  assert.equal(s.filing.value(loans, 'CY', UNF), 'Terms prejudicial.');
  assert.equal(s.filing.value(loans, 'CY', FAV), null);
  // the auditor's report is a current-year disclosure here (the previous-year columns are not open), so the lock of
  // the previous year does not concern it
  assert.equal(s.conceptStatus(q('WhetherCompaniesAuditorsReportOrderIsApplicableOnCompany'), 'PY').applicable, false);
});
