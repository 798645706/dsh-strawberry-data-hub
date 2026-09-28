import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient, checkSequences } from '../src/client.js';
import { validateArguments } from '../src/contracts.js';
const envelope = (result = { status: 'ambiguous', candidates: [{ species: 'A' }, { species: 'B' }] }) => ({ tool: 'gene_resolve', status: 'ok', result, provenance: { resultSha256: 'source-hash' } });
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('rejects dangerous/incorrect arguments before any HTTP request', async () => {
  const call = createClient({}, () => { throw new Error('must not fetch'); });
  for (const [name, args] of [['crispr_submit', {}], ['gene_context', { gene_id: 'gene' }],
    ['literature_search', { question: 'test', limit: 1.5 }], ['gene_resolve', { gene_id: '../x' }],
    ['gene_resolve', { gene_id: 'x', url: 'https://example.com' }]]) await assert.rejects(call(name, args), /SDH_/);
  assert.equal(validateArguments('literature_search', { question: 'test' }).limit, 3);
});
test('preserves ambiguity and provenance and does not forward model credentials', async () => {
  const call = createClient({}, async (url, options) => {
    assert.equal(url.pathname, '/strawberry/api/v1/ai/agent/tools/gene_resolve');
    assert.equal(options.headers.Authorization, undefined);
    return response(envelope());
  });
  const result = await call('gene_resolve', { gene_id: 'x' });
  assert.equal(result.result.status, 'ambiguous');
  assert.equal(result.result.candidates.length, 2);
  assert.equal(result.provenance.resultSha256, 'source-hash');
  assert.equal(result.answerReviewed, false);
});
test('handles rate limiting and wrong response envelope', async () => {
  await assert.rejects(createClient({}, async () => new Response('', { status: 429, headers: { 'retry-after': '7' } }))('gene_resolve', { gene_id: 'x' }), /SDH_HTTP_429.*7/);
  await assert.rejects(createClient({}, async () => response({ ...envelope(), tool: 'other' }))('gene_resolve', { gene_id: 'x' }), /SDH_PROTOCOL/);
});
test('rejects oversize evidence without silently truncating it', async () => {
  await assert.rejects(createClient({}, async () => response(envelope({ evidence: 'x'.repeat(61000) })))('gene_resolve', { gene_id: 'x' }), /SDH_CONTEXT_TOO_LARGE/);
});
test('propagates cancellation and enforces own deadline', async () => {
  const fetcher = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  await assert.rejects(createClient({ timeoutMs: 100 }, fetcher)('gene_resolve', { gene_id: 'x' }), /SDH_TIMEOUT/);
  const controller = new AbortController();
  const pending = createClient({}, fetcher)('gene_resolve', { gene_id: 'x' }, controller.signal);
  controller.abort(new Error('caller cancelled'));
  await assert.rejects(pending, /caller cancelled/);
});
test('checks sequence hash, length and assembly scope', () => {
  const args = { gene_id: 'x', species: 'Fragaria vesca', version: 'v6' };
  const entry = { type: 'protein', available: true, sequence: 'MAL', length: 3, sha256: createHash('sha256').update('MAL').digest('hex') };
  const result = { gene: { geneId: 'x', species: args.species, version: args.version }, sequences: [entry] };
  checkSequences(result, args);
  assert.throws(() => checkSequences({ ...result, sequences: [{ ...entry, sequence: 'MAA' }] }, args), /SDH_SEQUENCE_INTEGRITY/);
  assert.throws(() => checkSequences(result, { ...args, version: 'v4' }), /SDH_SCOPE_MISMATCH/);
});
