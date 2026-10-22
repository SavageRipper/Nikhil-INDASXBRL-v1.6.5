// v1.6.1: three weaknesses shown by a next-year standalone filing — FM-15 with an exempted child that is reported; a
// figure whose digits go finer than its imported accuracy (Filing Manual #13); numbered members with a gap (GR-3).
// Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { authority, q } from './helpers.mjs';
import { baseSession, exampleSession, runRule } from './fixtures.mjs';
import { fixFor } from './fixes.js';

const A = authority();
const today = '2018-09-30';

test('FM-15: "Other loans and advances" with its exempted child "… others" reported is complete (the child is present)', () => {
  const T = '400300:ClassificationOfBorrowingsTable';
  const dims = (m) => [{ axis: q('ClassificationBasedOnCurrentNoncurrentAxis'), member: q('NoncurrentMember') }, { axis: q('ClassificationOfBorrowingsAxis'), member: q(m) }, { axis: q('SubclassificationOfBorrowingsAxis'), member: q('SecuredBorrowingsMember') }];
  const s = baseSession();
  assert.ok(A.table(T));
  s.filing.setFact({ concept: q('Borrowings'), period: s.filing.period(q('Borrowings'), 'CY'), dims: dims('OtherLoansAndAdvancesOthersMember'), value: '500', origin: 'user' });
  s.filing.setFact({ concept: q('Borrowings'), period: s.filing.period(q('Borrowings'), 'CY'), dims: dims('OtherLoansAndAdvancesMember'), value: '500', origin: 'user' });
  const fm15 = (x) => runRule(x, 'FM-15', { scope: 'CY' }).res.filter((r) => r.status === 'FAIL' && /OtherLoansAndAdvancesMember|Other loans and advances \[Member\]/.test(r.message));
  assert.deepEqual(fm15(s), [], 'a reported exempted child is a child');
  // the parent alone, no child at all: still required (a child that is not exempted exists)
  const t = baseSession();
  t.filing.setFact({ concept: q('Borrowings'), period: t.filing.period(q('Borrowings'), 'CY'), dims: dims('OtherLoansAndAdvancesMember'), value: '500', origin: 'user' });
  assert.equal(fm15(t).length, 1);
});

test('Filing Manual #13: an imported figure finer than its declared accuracy — fixed in one click, or by typing it again; the value is unchanged', () => {
  const T = '400100:DisclosureOfClassesOfEquityShareCapitalTable';
  const D = [{ axis: q('ClassesOfEquityShareCapitalAxis'), member: q('EquityShares1Member') }];
  const C = q('ValueOfSharesPaidUp');
  const mk = () => { const s = baseSession(); s.filing.setFact({ concept: C, period: s.filing.period(C, 'CY'), dims: D, value: '68983570', decimals: '-3', origin: 'import' }); return s; };
  const s = mk();
  const issue = s.validate({ today }).issues.find((i) => i.code === 'decimals.nonSignificant');
  assert.ok(issue);
  const fx = fixFor(s, issue);
  assert.equal(fx.label, 'Declare its own accuracy');
  fx.apply();
  const x = s.filing.get(C, s.filing.period(C, 'CY'), D);
  assert.deepEqual([x.value, x.decimals], ['68983570', '-1']);
  assert.ok(!s.validate({ today }).issues.some((i) => i.code === 'decimals.nonSignificant'));
  // typing the same figure again (689.8357 lakhs … here in the filing's own scale) also corrects the accuracy
  const t = mk();
  const shown = t.displayOf(t.filing.get(C, t.filing.period(C, 'CY'), D));
  t.setTableValue(T, 'CY', D, C, shown, { recalc: true });
  const y = t.filing.get(C, t.filing.period(C, 'CY'), D);
  assert.equal(y.value, '68983570');
  assert.ok(Number(y.decimals) >= -1, y.decimals);
  // the previous year locked: offered, but not applied
  const u = mk(); u.filing.meta.pyLocked = true;
  u.filing.setFact({ concept: C, period: u.filing.period(C, 'PY'), dims: D, value: '68983570', decimals: '-3', origin: 'import' });
  const pi = u.validate({ today }).issues.find((i) => i.code === 'decimals.nonSignificant' && i.scope === 'PY') || u.validate({ today }).issues.filter((i) => i.code === 'decimals.nonSignificant').find((i) => u.filing.facts.get(i.factKey)?.period.date === u.filing.meta.periods.py.end);
  assert.ok(pi && fixFor(u, pi).disabled);
});

test('GR-3: shareholders numbered with a gap — "Close the gap" moves the last one into the missing number, in every table, that year only', () => {
  const s = exampleSession(); // share capital and its shareholders tables apply
  for (const x of s.filing.all()) if (x.dims.some((d) => d.axis === q('NameOfShareholderAxis'))) s.filing.removeFact(x.key);
  for (const sc of ['CY', 'PY']) s.setValue(q('WhetherThereAreAnyShareholdersHoldingMoreThanFivePerCentSharesInCompany'), sc, 'true');
  const cls = { axis: q('ClassesOfEquityShareCapitalAxis'), member: q('EquityShares1Member') };
  const sh = (n) => [cls, { axis: q('NameOfShareholderAxis'), member: q(`Shareholder${n}Member`) }];
  const put = (n, scope, name) => {
    for (const [c, v] of [['NameOfShareholder', name], ['CountryOfIncorporationOrResidenceOfShareholder', 'INDIA'], ['PermanentAccountNumberOfShareholder', 'ABCDE1234F'], ['NumberOfSharesHeldInCompany', '1000'], ['PercentageOfShareholdingInCompany', '0.1'], ['TypeOfShare', 'Equity']]) {
      s.filing.setFact({ concept: q(c), period: s.filing.period(q(c), scope), dims: sh(n), value: v, lang: A.isNumeric(q(c)) || !A.langAllowed(q(c)) ? null : 'en', origin: 'user' });
    }
  };
  put(1, 'CY', 'A'); put(2, 'CY', 'B'); put(4, 'CY', 'D'); put(1, 'PY', 'A'); put(2, 'PY', 'B'); put(4, 'PY', 'D');
  const gaps = () => s.validate({ today }).issues.filter((i) => i.ruleId === 'GR-3');
  assert.equal(gaps().length, 2, 'one per year');
  const cy = gaps().find((i) => i.scope === 'CY');
  assert.ok(cy.location?.tableId, 'the message opens the table of the member provided');
  const fx = fixFor(s, cy);
  assert.equal(fx.label, 'Close the gap');
  assert.match(fx.confirm, /Shareholder4Member|Shareholder 4/);
  fx.apply();
  assert.equal(s.filing.value(q('NameOfShareholder'), 'CY', sh(3)), 'D');
  assert.equal(s.filing.value(q('NumberOfSharesHeldInCompany'), 'CY', sh(3)), '1000');
  assert.equal(s.filing.value(q('TypeOfShare'), 'CY', sh(3)), 'Equity', 'also in the classes table');
  assert.equal(s.filing.value(q('NameOfShareholder'), 'CY', sh(4)), null);
  assert.equal(s.filing.value(q('NameOfShareholder'), 'PY', sh(4)), 'D', 'the other year unchanged');
  assert.deepEqual(gaps().map((i) => i.scope), ['PY']);
  // the previous year locked: offered, not applied
  s.filing.meta.pyLocked = true;
  assert.ok(fixFor(s, gaps()[0]).disabled);
});
