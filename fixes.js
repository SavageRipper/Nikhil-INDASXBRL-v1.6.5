// v1.3 (C&I v14) UI helper: a one-click remedy for a validation message, where the remedy is unambiguous. The gate and
// the MCA rules decide what is an error; a fix only performs an ordinary edit through the Session (the same path as
// typing: applicability, locks, recalculation), after the user confirms it. Messages without an unambiguous remedy
// have no fix (the message still opens its cell).
//
//   GR-1 a part entered, its total missing              → enter the total = the sum of its parts
//   GR-1 a previous-year opening value whose total has  → set it aside (Hidden data, restorable) — never a value of the
//        no cell for that date                             opening balance sheet column (first-time adoption, GR-16)
//   GR-1 total ≠ Σ parts (an entered / imported total)  → set the total to the sum of its parts
//   statement figure ≠ its note (the MCA rule tying them, e.g. borrowings) → take the figure from the note
//   a mandatory amount not present                      → report nil (0)
//   GR-5 one year entered, the other not                → report nil (0) for the other year
//   a value no tab shows (location 'pyo')               → set it aside
//   v1.6.4 a line item given under several members of a   → keep it under the member the user chooses (the value in
//        table that allows one (SR-L6448-1, [700400])          the other columns is removed)
// The rules are recognised by their handler or by the statement-note link, never by a C&I rule number.
import { statementNoteLinks } from './derived.js';
import * as Dec from './decimal.js';
import { cellFor, setAside } from './upkeep.js';
import { Gate } from './gate.js';
import { reportingYear } from './periods.js';

const PL = { CY: 'current year', PY: 'previous year', PYO: 'opening balance sheet of the previous year' };
const esc = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LOCKED = 'The previous year is locked (last year\'s filed figures) — unlock it first (tab tools).';
const handlerOf = (A, id) => A.rules.rules.find((r) => r.id === id)?.ast?.handler || null;

export function fixFor(S, issue) {
  if (!issue || (issue.severity !== 'ERROR' && issue.code !== 'total.identity')) return null;
  const A = S.A, f = S.filing;
  const fact = issue.factKey ? f.facts.get(issue.factKey) : null;
  // v1.6.2: a name / identifier in a table's TOTAL column (a warning) — clear it
  if (issue.code === 'total.identity' && fact) {
    if (S.periodLocked(fact.period)) return { label: 'Clear it', disabled: LOCKED };
    return { label: 'Clear it', confirm: `Clear <b>${esc(A.label(fact.concept))}</b> '${esc(String(fact.value).slice(0, 60))}' from the TOTAL column (${PL[f.scopeOf(fact.period)] || ''})? A name or identifier belongs to a member column.`, apply: () => S.removeFacts([fact]) };
  }
  const msg = String(issue.message || '').replace(/^\[[^\]]+\]\s*/, '');
  const handler = issue.ruleId ? handlerOf(A, issue.ruleId) : null;
  // v1.6.4 (C&I v14.5): a line item given against several members where the rule allows one (SR-L6448-1)
  if (issue.ruleId && A.rules.rules.find((r) => r.id === issue.ruleId)?.ast?.type === 'lineItemSingleMember' && issue.concept && issue.tableId) { const x = singleMemberFix(S, issue); if (x) return x; }
  // a value no tab shows (dated outside the filing's years, or a previous-year opening value without its cell)
  if (issue.location?.kind === 'pyo' && fact) {
    const other = f.scopeOf(fact.period) === 'OTHER';
    return { label: 'Set it aside', confirm: `Set aside <b>${esc(A.label(fact.concept))}</b> dated ${esc(fact.period.date || `${fact.period.start} → ${fact.period.end}`)}? ${other ? "It is outside this filing's two years" : 'No tab shows a cell for it'}; it stays in the project under Hidden data (restorable) and is no longer part of the filing.`, apply: () => setAside(S, [{ fact, reason: other ? 'otherDate' : 'openingNoCell' }], 'fix') };
  }
  // v1.5.5: tables of one name (details of subsidiaries in [611500] and [613400]) without a shared member — rename the
  // later table's rows to the member the same entity (matched by name) has in the first table
  if (/under the same name/.test(msg) && /No member is used in both tables/.test(msg)) {
    const scope = issue.scope || issue.location?.scope || 'CY';
    const plan = S.alignSharedMembers(scope);
    if (!plan.length) return null;
    return { label: 'Use the same members', confirm: `Rename these rows so that each entity has the same member in both tables?<br>${plan.map((x) => `[${esc(x.tableId.split(':')[0])}] <b>${esc(x.from)}</b> → <b>${esc(x.to)}</b> (${esc(x.name)})`).join('<br>')}<br>Only the member names change; the values stay as they are.`, apply: () => S.alignSharedMembers(scope, { apply: true }) };
  }
  // v1.6.1 (Filing Manual #13): digits finer than the declared accuracy — declare the accuracy of its own digits
  if (issue.code === 'decimals.nonSignificant' && fact) {
    const need = Dec.requiredDecimals(Dec.parse(fact.value)), d = need === Infinity ? 0 : Math.min(2, need);
    if (S.periodLocked(fact.period)) return { label: 'Declare its own accuracy', disabled: LOCKED };
    return { label: 'Declare its own accuracy', confirm: `<b>${esc(A.label(fact.concept))}</b> ${esc(S.displayOf(fact))} is declared accurate to ${esc(fact.decimals)} (decimals) but its digits go further. Declare it accurate to its own digits (decimals ${d})? The value does not change.`, apply: () => S.declareOwnAccuracy(fact.key) };
  }
  // v1.6.1 (GR-3): numbered members with a gap — move the values of the last member into the missing number
  {
    const m = /^Members on \((\w+)\) are not sequential: (\w+?) missing while (\w+?) is provided$/.exec(msg);
    const axis = m && A.qnameOfLocal(m[1]);
    if (axis && (issue.scope === 'CY' || issue.scope === 'PY')) {
      const ns = axis.split(':')[0], missing = `${ns}:${m[2]}`, from = `${ns}:${m[3]}`;
      if (A.concept(missing) && A.concept(from)) {
        if (S.pyLocked(issue.scope)) return { label: 'Close the gap', disabled: LOCKED };
        return { label: 'Close the gap', confirm: `Move every value of <b>${esc(A.label(from))}</b> (${PL[issue.scope]}) to <b>${esc(A.label(missing))}</b>, so that the members are numbered without a gap? Only the member changes; the values stay as they are. The order of the columns changes accordingly.`, apply: () => S.closeMemberGap(axis, issue.scope, missing, from) };
      }
    }
  }
  // GR-1: a part entered, its total missing
  if (handler === 'calc-parent-child' && fact && /is entered but its calculation parent/.test(msg)) {
    const sc = f.scopeOf(fact.period);
    const parents = S.calcParentsOf(fact.concept, fact.period, fact.dims);
    const g = new Gate(A);
    for (const p of parents) {
      if (sc === 'PYO' && !g.openingCell(f, p, fact.period, fact.dims)) continue; // no cell for this total at that date
      const t = S.totalFromParts(p, fact.period, fact.dims);
      if (!t) continue;
      if (S.periodLocked(fact.period)) return { label: 'Enter the total', disabled: LOCKED };
      return { label: `Enter ${A.label(p)} = sum of parts`, confirm: `Enter <b>${esc(A.label(p))}</b> (${PL[sc] || sc}) as the sum of its parts reported here: <b>${esc(S.displayOf({ concept: p, value: t.value, nil: false }))}</b>.`, apply: () => S.setTotalFromParts(p, fact.period, fact.dims) };
    }
    // a previous-year opening value whose totals have no cell for that date (never one the GR-16 column shows)
    const inSheet = g.openingCell(f, fact.concept, fact.period, fact.dims)?.scope === 'PYO';
    if (sc === 'PYO' && !inSheet && !parents.some((p) => g.openingCell(f, p, fact.period, fact.dims))) {
      if (S.periodLocked(fact.period)) return { label: 'Set this opening value aside', disabled: LOCKED };
      return { label: 'Set this opening value aside', confirm: `Set aside the previous-year opening value <b>${esc(A.label(fact.concept))}</b> dated ${esc(fact.period.date)}? Its total has no cell for that date. It stays in the project under Hidden data (restorable) and is no longer part of the filing.`, apply: () => setAside(S, [{ fact, reason: 'openingNoCell' }], 'fix') };
    }
    return null;
  }
  // GR-1: total ≠ Σ parts, the total was entered or imported (a calculated total follows its parts by itself)
  if (handler === 'calc-parent-child' && fact && /^Calculation inconsistency/.test(msg) && fact.origin !== 'calculated') {
    const t = S.totalFromParts(fact.concept, fact.period, fact.dims);
    if (!t) return null;
    const sc = f.scopeOf(fact.period);
    if (S.periodLocked(fact.period)) return { label: 'Set total = sum of parts', disabled: LOCKED };
    return { label: 'Set total = sum of parts', confirm: `Replace <b>${esc(A.label(fact.concept))}</b> (${PL[sc] || sc}) ${esc(S.displayOf(fact))} by the sum of its parts <b>${esc(S.displayOf({ concept: fact.concept, value: t.value, nil: false }))}</b>? Only if the parts are right — otherwise correct the parts.`, apply: () => S.setTotalFromParts(fact.concept, fact.period, fact.dims) };
  }
  // a statement figure that differs from its note (the MCA rule tying them)
  for (const l of statementNoteLinks(A).values()) {
    if (l.kind !== 'sum' || l.ruleId !== issue.ruleId) continue;
    const sc = issue.scope === 'PY' ? 'PY' : 'CY';
    const v = S.noteValue(l, sc);
    const p = f.period(l.concept, sc);
    const x = p && f.get(l.concept, p, []);
    if (!v || v.undetermined || !x) continue;
    if (S.periodLocked(p)) return { label: 'Take the figure from the note', disabled: LOCKED };
    const total = Dec.toString(v.total);
    return { label: 'Take the figure from the note', confirm: `Set <b>${esc(A.label(l.concept))}</b> (${PL[sc]}) to the note's figure <b>${esc(S.displayOf({ concept: l.concept, value: total, nil: false }))}</b> (now ${esc(S.displayOf(x))})? Only if the note is right — otherwise correct the note.`, apply: () => { f.setFact({ concept: l.concept, period: p, dims: [], value: total, decimals: v.decimals, unit: v.unit || x.unit, origin: 'calculated' }); S.recalcFrom(l.concept, p, [], 0, { before: x.value, after: total }); } };
  }
  // a mandatory amount not present → nil
  const m = /^'(.+)' is mandatory — not present for (CY|PY) /.exec(msg);
  if (m && issue.concept && A.isNumeric(issue.concept)) return nilFix(S, issue.concept, m[2], []);
  // GR-5: one year entered, the other not → nil for the other year (the message is located at the missing cell)
  if (handler === 'cy-py-pairing' && issue.concept && A.isNumeric(issue.concept) && /value should be entered/.test(msg) && (issue.scope === 'CY' || issue.scope === 'PY')) {
    const other = issue.scope === 'CY' ? 'PY' : 'CY';
    const op = f.period(issue.concept, other);
    const prev = op && f.get(issue.concept, op, issue.dims || []);
    return nilFix(S, issue.concept, issue.scope, issue.dims || [], prev, other);
  }
  return null;
}

// v1.6.4 (C&I v14.5, SR-L6448-1): a line item given against several members — the user chooses the member to keep it
// under (fix.choose); its value in the other columns is removed (an ordinary edit of those cells)
function singleMemberFix(S, issue) {
  const A = S.A, f = S.filing;
  const sc = issue.scope === 'PY' ? 'PY' : 'CY';
  const t = A.table(issue.tableId);
  if (!t) return null;
  const axes = new Set(t.axes.map((a) => a.axis));
  const facts = f.all().filter((x) => x.concept === issue.concept && !x.nil && x.dims.length && x.dims.every((d) => axes.has(d.axis)) && reportingYear(f.meta.periods, x.period) === sc);
  if (facts.length < 2) return null;
  const label = 'Keep it under one member';
  if (S.pyLocked(sc)) return { label, disabled: LOCKED };
  const name = (x) => x.dims.map((d) => (d.member ? A.label(d.member) : d.typed)).join(' · ');
  const preview = (x) => { const v = String(x.value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); return v.length > 50 ? v.slice(0, 50) + '…' : v; };
  return {
    label,
    choose: [{ label: 'Keep it under', options: facts.map((x, i) => ({ value: String(i), label: `${name(x)} — ${preview(x)}` })) }],
    confirm: `<b>${esc(A.label(issue.concept))}</b> (${PL[sc]}) is given under ${facts.length} members; the MCA rule allows one. Choose the member to keep it under — its value in the other column(s) is removed:`,
    apply: (chosen) => {
      const keep = Number((chosen && chosen[0]) ?? 0);
      facts.forEach((x, i) => { if (i !== keep) S.setTableValue(issue.tableId, sc, x.dims, x.concept, '', { recalc: true }); });
    },
  };
}

function nilFix(S, concept, scope, dims = [], otherFact = null, otherScope = null) {
  const A = S.A;
  const period = S.filing.period(concept, scope);
  if (S.pyLocked(scope)) return { label: 'Report nil (0)', disabled: LOCKED };
  const confirm = `Report <b>${esc(A.label(concept))}</b> as <b>0</b> for the ${PL[scope]}${otherFact ? ` (the ${PL[otherScope]} reports ${esc(S.displayOf(otherFact))})` : ''}? Only if the amount really is nil — otherwise enter the figure in its cell.`;
  return { label: 'Report nil (0)', confirm, apply: () => {
    const t = cellFor(S, { concept, period, dims });
    if (t.why) throw new Error(`No cell for this value: ${t.why}`);
    if (t.kind === 'row') return S.setValue(concept, t.scope, '0', { preferredLabel: t.preferredLabel, tab: t.elrUri, recalc: true });
    return S.setTableValue(t.tableId, t.scope, t.dims, concept, '0', { preferredLabel: t.preferredLabel, recalc: true, lockCalculated: true });
  } };
}
