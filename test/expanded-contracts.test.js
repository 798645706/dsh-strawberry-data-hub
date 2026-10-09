import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/index.js';
import { contracts, validateArguments } from '../src/contracts.js';
import { createClient } from '../src/client.js';
import { createEvidenceChecks } from '../src/evidence-check.js';
import { literatureScope } from '../src/science.js';
import { websiteLinks } from '../src/links.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/public-examples-20261009.json', import.meta.url), 'utf8'));

test('batch annotation counts actual arrays and preserves zero versus unreported and unresolved rows', async () => {
  const result = { rows: [
    { geneId: 'g1', status: 'annotated', goTerms: Array.from({ length: 48 }, (_, i) => `GO:${i}`) },
    { geneId: 'g2', status: 'resolved_without_functional_annotation', goTerms: [] },
    { geneId: 'g3', status: 'not_found' },
  ] };
  const output = await createClient({}, async () => Response.json({ tool: 'batch_gene_annotation', status: 'ok', result }))
    ('batch_gene_annotation', { gene_ids: ['g1', 'g2', 'g3'] });
  assert.deepEqual(output.result, result);
  assert.equal(output.annotationMetrics.returnedRowCount, 3);
  assert.deepEqual(output.annotationMetrics.rows.map(r => r.goTermCount), [48, 0, null]);
  assert.equal(output.annotationMetrics.rows[2].status, 'not_found');
});

test('website navigation and downloads remain absolute without changing provenance-covered results', async () => {
  const base = new URL('https://example.org/strawberry/');
  const result = { selected: { url: '/jbrowse/?config=x' }, launcherUrl: 'browse.html', matches: [{ href: '/strawberry/file/a' }],
    rejected: [{ url: 'javascript:alert(1)' }, { url: '//external.org/file' }, { url: 'https://user:pass@example.org/file' }, { url: '\\evil' }] };
  assert.deepEqual(websiteLinks(result, base), [
    { field: '/result/selected/url', url: 'https://example.org/jbrowse/?config=x' },
    { field: '/result/launcherUrl', url: 'https://example.org/strawberry/browse.html' },
    { field: '/result/matches/0/href', url: 'https://example.org/strawberry/file/a' },
  ]);
  const output = await createClient({ baseUrl: base.href }, async () => Response.json({ tool: 'jbrowse_open', status: 'ok', result,
    provenance: { resultSha256: 'original' } }))('jbrowse_open', {});
  assert.deepEqual(output.result, result);
  assert.equal(output.provenance.resultSha256, 'original');
  assert.equal(output.websiteLinks.length, 3);
});

test('reviewed public examples validate; orchestration-only and unknown tools stay blocked', () => {
  assert.equal(contracts.length, 29);
  for (const c of contracts) for (const example of fixtures.find(t => t.name === c.backend).examples) {
    assert.doesNotThrow(() => validateArguments(c.backend, example), c.backend);
  }
  for (const name of ['blast_search', 'crispr_submit', 'genome_prediction_submit', '__proto__']) {
    assert.throws(() => validateArguments(name, {}), /SDH_UNKNOWN_TOOL/);
  }
});

test('rejects malformed lists, ranges and operation inputs before transport', async () => {
  let requests = 0;
  const call = createClient({}, async () => { requests++; throw Error('Must not fetch'); });
  const invalid = [
    ['batch_gene_annotation', { gene_ids: [] }],
    ['batch_gene_annotation', { gene_ids: Array.from({ length: 51 }, (_, i) => `gene${i}`) }],
    ['batch_gene_annotation', { gene_ids: ['gene', ' gene '] }],
    ['batch_gene_annotation', { gene_ids: ['gene', 'evil/../gene'] }],
    ['batch_gene_annotation', { gene_ids: Array(2) }],
    ['batch_gene_annotation', { gene_ids: 'gene' }],
    ['coexpression_query', { operation: 'query', cutoff: 0.49 }],
    ['coexpression_query', { operation: 'query', limit: 51 }],
    ['graph_variation_query', { operation: 'region', start: 0 }],
    ['metabolite_search', { mz: Infinity }],
    ['metabolite_search', { tolerance: NaN }],
    ['genome_evidence_query', { operation: 'interval', start: -1 }],
    ['genome_evidence_query', { operation: 'interval', end: 1.5 }],
    ['genome_evidence_query', { operation: 'interval', coordinate_system: '1-based' }],
    ['genome_evidence_query', { operation: 'predictions' }],
    ['genome_prediction_prepare', { operation: 'submit' }],
    ['genome_prediction_prepare', { operation: 'prepare', ref: 'N' }],
    ['genome_prediction_prepare', { operation: 'prepare', confirmed: true }],
    ['sequence_analysis', { operation: 'toolkit', sequence: 'A'.repeat(50001) }],
    ['database_status', { token: 'never send credentials' }],
  ];
  for (const [name, args] of invalid) await assert.rejects(call(name, args), /SDH_INVALID_ARGUMENT/, `${name}: ${JSON.stringify(args)}`);
  assert.equal(requests, 0);
  assert.deepEqual(validateArguments('batch_gene_annotation', { gene_ids: [' gene1 ', 'gene2'] }), { gene_ids: ['gene1', 'gene2'] });
  assert.equal(validateArguments('genome_evidence_query', { operation: 'interval', start: 0 }).start, 0);
  assert.equal(validateArguments('coexpression_query', { operation: 'query', cutoff: 0.5 }).cutoff, 0.5);
});

test('every added tool executes through real DSH runtime with array/number/enum wire schemas', async () => {
  const originals = new Set(['literature_search', 'gene_resolve', 'gene_context', 'sequence_fetch', 'data_catalog']);
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const args = JSON.parse(Buffer.concat(chunks));
    const tool = req.url.split('/').at(-1);
    seen.push({ tool, args });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tool, status: 'ok', result: { status: 'selection_required', args }, provenance: { resultSha256: 'fixture' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const ctx = new Context();
  try {
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(plugin, { baseUrl: `http://127.0.0.1:${server.address().port}/`, researchOnly: true });
    for (const c of contracts.filter(c => !originals.has(c.backend))) {
      const args = fixtures.find(t => t.name === c.backend).examples[0];
      const result = await ctx.tools.execute({ callId: c.backend, name: `sdh_${c.backend}`, arguments: args, signal: new AbortController().signal });
      assert.equal(result.isError, false, JSON.stringify(result));
      const output = JSON.parse(result.content[0].text);
      assert.equal(output.businessStatus, 'selection_required');
      assert.equal(output.provenance.resultSha256, 'fixture');
      assert.deepEqual(output.result.args, validateArguments(c.backend, args));
    }
    assert.equal(seen.length, 24);
    const result = await ctx.tools.execute({ callId: 'invalid-list', name: 'sdh_batch_gene_annotation', arguments: { gene_ids: ['gene', 'gene'] }, signal: new AbortController().signal });
    assert.equal(result.isError, true);
    assert.equal(seen.length, 24);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    ctx.registry.delete(plugin);
    ctx.registry.delete(ToolRuntime);
    ctx.registry.delete(SystemPrompt);
  }
});

test('abstract and expanded-fulltext sources retain identity and work with session evidence checks', () => {
  const checks = createEvidenceChecks();
  const session = {};
  const result = Object.fromEntries(['discovery', 'discoveryFulltext'].map(tier => [tier, [{ node: {
    evidence_id: tier, doi: `10.0000/${tier}`, citation_eligible: true, text: 'Observed red fruit in the experimental material.',
  } }]]));
  const scope = literatureScope(result, { limit: 2 });
  assert.equal(scope.tiers.discovery.returnedRecordCount, 1);
  assert.equal(scope.tiers.discoveryFulltext.references[0].evidenceId, 'discoveryFulltext');
  const saved = checks.remember(session, { result });
  for (const tier of ['discovery', 'discoveryFulltext']) {
    const output = checks.check(session, { snapshot_id: saved.id, claims: [{
      evidence_id: tier, doi: `10.0000/${tier}`, quote: 'Observed red fruit', conclusion: 'Observed red fruit.', material: 'experimental material', kind: 'observation',
    }] });
    assert.deepEqual(output.claims[0].issues, []);
    assert.equal(output.semanticSupportVerified, false);
  }
});
