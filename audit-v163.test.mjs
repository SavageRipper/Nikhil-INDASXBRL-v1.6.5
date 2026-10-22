// v1.6.3: the instance lists the current year first — contexts and, for each element, the current-year fact before the
// previous-year fact — as the MCA-filed reference instances do. The MCA AOC-4 XBRL form can report "Mismatch in financial
// year (to which financial statements relates) in Form and instance document" for an instance (accepted by the MCA XBRL
// Validator) whose first context and first DateOfStartOfReportingPeriod / DateOfEndOfReportingPeriod facts are the
// previous year's. Synthetic data, plus the reference instances when present.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { authority, importSession } from './helpers.mjs';
import { exampleSession, exportUnchecked } from './fixtures.mjs';
import { scopeOf } from './periods.js';

const A = authority();
const contexts = (xml) => [...xml.matchAll(/<xbrli:context id="([^"]+)">[\s\S]*?<xbrli:period>([\s\S]*?)<\/xbrli:period>([\s\S]*?)<\/xbrli:context>/g)]
  .map((m) => {
    const d = m[2].replace(/<[^>]+>/g, ' ').trim().split(/\s+/);
    return { id: m[1], period: d.length === 2 ? { type: 'duration', start: d[0], end: d[1] } : { type: 'instant', date: d[0] }, dims: /scenario/.test(m[3]) };
  });
const periodFacts = (xml) => [...xml.matchAll(/<in-ca:(DateOfStartOfReportingPeriod|DateOfEndOfReportingPeriod) contextRef="[^"]+">([^<]+)</g)].map((m) => [m[1], m[2]]);
const RANK = { CY: 0, PY: 1, PYO: 2 };

function check(xml, periods, label) {
  const { cy, py } = periods;
  const c = contexts(xml);
  assert.deepEqual([c[0].period, c[0].dims], [{ type: 'duration', start: cy.start, end: cy.end }, false], `${label}: the first context is the current year, without dimensions`);
  const ranks = c.map((x) => RANK[scopeOf(periods, x.period)] ?? 3);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${label}: current year, previous year, opening date, then other dates`);
  assert.deepEqual(periodFacts(xml), [['DateOfStartOfReportingPeriod', cy.start], ['DateOfStartOfReportingPeriod', py.start], ['DateOfEndOfReportingPeriod', cy.end], ['DateOfEndOfReportingPeriod', py.end]], label);
  // every element: its current-year facts before its previous-year facts
  const byId = new Map(c.map((x) => [x.id, RANK[scopeOf(periods, x.period)] ?? 3]));
  const last = new Map();
  for (const m of xml.matchAll(/\n {2}<([\w-]+:\w+) contextRef="([^"]+)"/g)) {
    const r = byId.get(m[2]);
    assert.ok(r >= (last.get(m[1]) ?? 0), `${label}: ${m[1]} — a later year's fact before an earlier year's`);
    last.set(m[1], r);
  }
}

test('a filing entered here: the current year first (contexts, reporting-period dates, every element)', () => {
  const s = exampleSession();
  check(exportUnchecked(s, '2018-09-30'), s.filing.meta.periods, 'example');
});

const REFS = ['golden-ref-a-2022-23.xml', 'golden-ref-b-2024-25.xml', 'golden-ref-c-standalone-2024-25.xml', 'golden-ref-c-consolidated-2024-25.xml'];
test('the reference instances (filed with MCA) list the current year first; regenerated, they do too — with the same facts', { skip: !REFS.some((g) => existsSync(g)) && 'golden files not present' }, () => {
  for (const g of REFS) {
    if (!existsSync(g)) continue;
    const src = readFileSync(g, 'utf8');
    const { s } = importSession(src);
    const P = s.filing.meta.periods;
    const first = contexts(src).find((x) => !x.dims);
    assert.equal(scopeOf(P, first.period), 'CY', `${g} as filed`);
    assert.deepEqual(periodFacts(src.replace(/ id="[^"]*"/g, '')).map((x) => x[1]), [P.cy.start, P.py.start, P.cy.end, P.py.end], `${g} as filed`);
    const xml = exportUnchecked(s, '2025-09-30');
    check(xml, P, g);
  }
});
