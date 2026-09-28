import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from '../src/client.js';
import { buildFasta, renderResult } from '../src/export.js';
const args = { gene_id: 'synthetic_boundary', species: 'Fixture species', version: 'fixture-v1', type: 'cds' };
const makeResult = sequence => ({ status: 'ok', gene: { geneId: args.gene_id, species: args.species, version: args.version }, sequences: [{
  type: 'cds', available: true, sequence, length: sequence.length,
  sha256: createHash('sha256').update(sequence).digest('hex'),
  fastaHeader: `>${args.gene_id}|species=${args.species}|assembly=${args.version}|type=cds`,
}] });
test('synthetic 300 kb CDS round-trips losslessly and stays out of native model content', async () => {
  const sequence = 'ACGTN'.repeat(60000);
  const result = makeResult(sequence);
  const value = await createClient({}, async () => new Response(JSON.stringify({ tool: 'sequence_fetch', status: 'ok', result }), { headers: { 'content-type': 'application/json' } }))('sequence_fetch', args);
  const fasta = buildFasta(value.result, args);
  assert.equal(fasta.content.split('\n').slice(1).join(''), sequence);
  assert.ok(fasta.content.split('\n').slice(1).every(line => line.length <= 80));
  assert.ok(renderResult(value)[0].text.length < 5000);
  assert.equal(value.sequenceMetrics[0].nucleotideCount, 300000);
  assert.match(value.sequenceMetrics[0].lengthMeaning, /NOT stop codons/);
});
test('rejects a streamed response over 1 MiB without delivering a partial sequence', async () => {
  const result = makeResult('A'.repeat(1100000));
  const call = createClient({}, async () => new Response(JSON.stringify({ tool: 'sequence_fetch', status: 'ok', result }), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(call('sequence_fetch', args), /SDH_RESPONSE_TOO_LARGE/);
});
