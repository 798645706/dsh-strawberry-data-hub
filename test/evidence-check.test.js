import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceChecks, validateClaims } from '../src/evidence-check.js';

const node = () => ({ evidence_id: 'lit:fixture', doi: '10.0000/fixture', citation_eligible: true,
  text: 'In cultivar A, treatment T decreased pigment by 50.0% compared with control C.',
  subject_or_material: 'cultivar A', qualification_zh: 'Only tested material.' });
const claim = () => ({ conclusion: '处理T的色素相对对照C减少50.0%。', evidence_id: 'lit:fixture', doi: '10.0000/fixture',
  quote: node().text, material: 'cultivar A', kind: 'quantitative', value: '50.0', unit: '%', comparator: 'T versus C' });
function setup(nodes = [node()]) {
  const checker = createEvidenceChecks();
  const session = {};
  const input = { snapshot_id: checker.remember(session, { result: { fulltext: nodes.map(node => ({ node })) } }).id, claims: [claim()] };
  return { checker, session, input };
}

test('matched citation, quote and numeric literal do not imply semantic approval', () => {
  const { checker, session, input } = setup();
  const result = checker.check(session, input);
  assert.equal(result.status, 'reference_checks_passed_semantics_unreviewed');
  assert.equal(result.answerReviewed, false);
  assert.equal(result.semanticSupportVerified, false);
  // A wrong unit/control is not claimed to be verified by literal matching.
  input.claims[0].unit = 'mg'; input.claims[0].comparator = 'invented comparator';
  const unverified = checker.check(session, input);
  assert.equal(unverified.semanticSupportVerified, false);
  assert.match(unverified.notice, /comparators.*remain unverified/);
});

test('rejects fabricated identity, mismatched DOI, excerpt and numeric value independently', () => {
  const { checker, session, input } = setup();
  for (const [field, value, issue] of [['evidence_id', 'invented', 'EVIDENCE_ID_MISSING_OR_AMBIGUOUS'],
    ['doi', '10.0000/wrong', 'DOI_MISMATCH'], ['quote', 'invented 50.0%', 'QUOTE_NOT_IN_SOURCE'],
    ['value', '5', 'VALUE_NOT_IN_QUOTE']]) {
    const draft = structuredClone(input); draft.claims[0][field] = value;
    const result = checker.check(session, draft);
    assert.equal(result.status, 'issues_found');
    assert.ok(result.claims[0].issues.includes(issue));
  }
});

test('source identity cannot be borrowed across sessions and snapshots expire or are evicted', () => {
  let time = 0;
  const checker = createEvidenceChecks({ now: () => time });
  const session = {};
  const value = { result: { fulltext: [{ node: node() }] } };
  const input = { snapshot_id: checker.remember(session, value).id, claims: [claim()] };
  assert.throws(() => checker.check({}, input), /SDH_CHECK_SNAPSHOT/);
  time = 1800000;
  assert.throws(() => checker.check(session, input), /SDH_CHECK_SNAPSHOT/);
  input.snapshot_id = checker.remember(session, value).id;
  for (let i = 0; i < 8; i++) checker.remember(session, value);
  assert.throws(() => checker.check(session, input), /SDH_CHECK_SNAPSHOT/);
});

test('snapshots are detached, cannot be model-supplied, and ambiguous/noneligible IDs fail', () => {
  const n = node();
  const { checker, session, input } = setup([n]);
  n.text = 'mutated';
  assert.equal(checker.check(session, input).status, 'reference_checks_passed_semantics_unreviewed');
  for (const [nodes, code] of [[[node(), node()], 'EVIDENCE_ID_MISSING_OR_AMBIGUOUS'],
    [[{ ...node(), citation_eligible: false }], 'SOURCE_NOT_CITATION_ELIGIBLE']]) {
    const s = setup(nodes);
    assert.ok(s.checker.check(s.session, s.input).claims[0].issues.includes(code));
  }
  assert.throws(() => validateClaims({ ...input, source: node() }), /SDH_CHECK_INPUT/);
});

test('missing quantity fields, unbounded claims and computed values are rejected', () => {
  const { input } = setup();
  for (const key of ['material', 'unit', 'comparator', 'value']) {
    const bad = structuredClone(input); delete bad.claims[0][key];
    assert.throws(() => validateClaims(bad), /SDH_CHECK_INPUT/);
  }
  assert.throws(() => validateClaims({ ...input, claims: [] }), /SDH_CHECK_INPUT/);
  assert.throws(() => validateClaims({ ...input, claims: Array(9).fill(claim()) }), /SDH_CHECK_INPUT/);
  const bad = structuredClone(input); bad.claims[0].value = '100 / 2';
  assert.throws(() => validateClaims(bad), /SDH_CHECK_INPUT/);
});

test('scope flags remain advisory and gene-name digits alone do not count as quantitative claims', () => {
  const { checker, session, input } = setup();
  input.claims[0].conclusion = '统一提升百分比不存在';
  assert.ok(checker.check(session, input).claims[0].issues.includes('SCOPE_WORDING_REQUIRES_REVIEW'));
  input.claims = [{ conclusion: 'FvSTOP1是研究对象', evidence_id: 'lit:fixture', doi: '10.0000/fixture',
    quote: node().text, material: 'cultivar A', kind: 'observation' }];
  assert.deepEqual(checker.check(session, input).claims[0].issues, []);
  assert.equal(checker.check(session, input).semanticSupportVerified, false);
});
