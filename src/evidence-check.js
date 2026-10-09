import { randomUUID } from 'node:crypto';

const text = description => ({ type: 'string', required: true, description });
export const checkParameters = {
  snapshot_id: text('Exact evidenceSnapshot.id returned by sdh_literature_search in this session.'),
  claims: { type: 'array', required: true, description: '1–8 proposed claims, one source per claim. Numbers must be copied, not calculated. Use quantitative for every numeric result.',
    items: { type: 'json' } },
};
export const checkDescription = 'Check structured literature claims against an actual SDH retrieval snapshot in this session. Each claims item must have conclusion, evidence_id, doi, quote (exact source excerpt), material, kind (observation/intervention/mechanism/quantitative). Quantitative items also require value (numeric string), unit and comparator (explicit treatment/control). Other fields are rejected. Checks source identity, quotation and numeric occurrence, not scientific entailment or final prose. Correct issues before answering; never label the final answer reviewed.';

function validString(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
export function validateClaims(input) {
  if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['snapshot_id', 'claims'].includes(k)) ||
      !validString(input.snapshot_id, 100) || !Array.isArray(input.claims) || input.claims.length < 1 || input.claims.length > 8) {
    throw new Error('SDH_CHECK_INPUT: Provide snapshot_id and 1–8 structured claims.');
  }
  for (const c of input.claims) {
    const base = ['conclusion', 'evidence_id', 'doi', 'quote', 'material', 'kind'];
    const keys = c?.kind === 'quantitative' ? [...base, 'value', 'unit', 'comparator'] : base;
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(k => !keys.includes(k)) ||
        keys.some(k => !validString(c[k], k === 'quote' ? 4000 : 1000)) ||
        !['observation', 'intervention', 'mechanism', 'quantitative'].includes(c.kind) ||
        (c.kind === 'quantitative' && !/^-?\d+(?:\.\d+)?$/.test(c.value))) {
      throw new Error('SDH_CHECK_INPUT: Invalid claim fields. Quantitative claims require a literal numeric string, unit and explicit comparator; do not invent missing fields.');
    }
  }
}

const fields = ['text', 'outcome_summary_zh', 'outcome_summary_en', 'subject_or_material',
  'intervention_or_exposure', 'study_design_or_method', 'qualification_zh'];

export function createEvidenceChecks({ now = Date.now } = {}) {
  const sessions = new WeakMap();
  function remember(session, value) {
    if (!session || typeof session !== 'object') return { available: false, reason: 'DSH session context required.' };
    let snapshots = sessions.get(session);
    if (!snapshots) sessions.set(session, snapshots = new Map());
    for (const [id, saved] of snapshots) if (now() - saved.createdAt >= 30 * 60 * 1000) snapshots.delete(id);
    const id = randomUUID();
    const nodes = ['evidence', 'fulltext', 'discovery', 'discoveryFulltext'].flatMap(tier => (Array.isArray(value.result[tier]) ? value.result[tier] : [])
      .map(entry => entry?.node).filter(n => n && typeof n === 'object'));
    snapshots.set(id, { createdAt: now(), nodes: structuredClone(nodes) });
    while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value);
    return { available: true, id, expiresInSeconds: 1800,
      usage: 'Use sdh_evidence_check before literature conclusions. In-memory, same session only; latest 8 searches retained. Re-run search after expiry/restart. Never fill missing numerical fields by guessing.' };
  }
  function check(session, input) {
    validateClaims(input);
    const saved = sessions.get(session)?.get(input.snapshot_id);
    if (!saved || now() - saved.createdAt >= 30 * 60 * 1000) {
      throw new Error('SDH_CHECK_SNAPSHOT: Snapshot missing or expired in this session; repeat literature search.');
    }
    const claims = input.claims.map((claim, index) => {
      const issues = [];
      const matches = saved.nodes.filter(n => n.evidence_id === claim.evidence_id);
      const node = matches.length === 1 ? matches[0] : undefined;
      if (!node) issues.push('EVIDENCE_ID_MISSING_OR_AMBIGUOUS');
      else {
        if (node.citation_eligible !== true) issues.push('SOURCE_NOT_CITATION_ELIGIBLE');
        if (node.doi !== claim.doi) issues.push('DOI_MISMATCH');
        if (!fields.some(k => typeof node[k] === 'string' && node[k].includes(claim.quote))) issues.push('QUOTE_NOT_IN_SOURCE');
      }
      if (claim.kind === 'quantitative') {
        // Literal numeric occurrence only, not a unit, denominator or causality proof.
        const numbers = claim.quote.match(/-?\d+(?:\.\d+)?/g) ?? [];
        if (!numbers.includes(claim.value)) issues.push('VALUE_NOT_IN_QUOTE');
      } else if (/\d+(?:\.\d+)?\s*(?:%|％|倍|个|nt\b|aa\b)/i.test(claim.conclusion)) issues.push('NUMERIC_TEXT_REQUIRES_QUANTITATIVE_REVIEW');
      // Advisory detection, deliberately not advertised as complete language analysis.
      if (/不存在|所有.{0,24}(均|都|一定)|统一.{0,12}(百分比|提升)|\b(all cultivars|does not exist|universal)\b/i.test(claim.conclusion)) issues.push('SCOPE_WORDING_REQUIRES_REVIEW');
      return { index, proposedClaim: claim, issues, source: node ? {
        evidenceId: node.evidence_id, doi: node.doi ?? null,
        material: node.subject_or_material ?? null,
        studyDesign: node.study_design_or_method ?? null,
        qualification: node.qualification_zh ?? null,
      } : null };
    });
    return { tool: 'sdh_evidence_check', status: claims.some(c => c.issues.length) ? 'issues_found' : 'reference_checks_passed_semantics_unreviewed',
      claims, answerReviewed: false, semanticSupportVerified: false,
      notice: 'Only snapshot identity, citation eligibility, exact excerpt and literal numeric occurrence were checked. Proposed materials, units, comparators, causal meaning, calculations and final answer remain unverified. Wording flags are incomplete heuristics, including possible false positives. Fix issues and inspect the source context; never call this scientific approval.' };
  }
  return { remember, check };
}
