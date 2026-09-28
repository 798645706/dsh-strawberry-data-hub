import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildFasta, exportFasta, renderResult } from '../src/export.js';
import { createClient } from '../src/client.js';
const hash = text => createHash('sha256').update(text).digest('hex');
const args = { gene_id: 'gene.1', species: 'Fragaria vesca', version: 'v6', type: 'protein' };
const result = { status: 'ok', gene: { geneId: args.gene_id, species: args.species, version: args.version }, sequences: [{
  type: 'protein', available: true, sequence: 'MAL*', length: 4, sha256: hash('MAL*'),
  fastaHeader: '>gene.1|species=Fragaria vesca|assembly=v6|type=protein',
}] };
test('keeps stop symbol, separates residue/character counts and hashes', async () => {
  const value = await createClient({}, async () => new Response(JSON.stringify({ tool: 'sequence_fetch', status: 'ok', result }), { headers: { 'content-type': 'application/json' } }))('sequence_fetch', args);
  assert.equal(value.sequenceMetrics[0].characterCount, 4);
  assert.equal(value.sequenceMetrics[0].aminoAcidResidueCount, 3);
  const fasta = buildFasta(result, args);
  assert.equal(fasta.content, result.sequences[0].fastaHeader + '\nMAL*\n');
  assert.equal(hash(fasta.content), fasta.fileSha256);
  assert.notEqual(fasta.fileSha256, result.sequences[0].sha256);
  assert.ok(!renderResult(value)[0].text.includes('MAL*'));
});
test('does not export absent sequence, corrupt data or injected/mismatched headers', () => {
  assert.throws(() => buildFasta({ ...result, sequences: [] }, args), /SDH_NO_SEQUENCE/);
  for (const fastaHeader of ['>wrong', '>gene\nINJECT', 'gene']) {
    assert.throws(() => buildFasta({ ...result, sequences: [{ ...result.sequences[0], fastaHeader }] }, args), /SDH_/);
  }
  assert.throws(() => buildFasta({ ...result, sequences: [{ ...result.sequences[0], sequence: 'XXX' }] }, args), /SDH_SEQUENCE_INTEGRITY/);
});
test('writes create-only through host filesystem, verifies saved bytes before delivery', async () => {
  let saved;
  const fs = {
    resolve: async p => ({ displayPath: p }), contains: () => true,
    writeText: async (_target, content, intent) => { assert.equal(intent.kind, 'createIfAbsent'); saved = content; },
    readBytes: async () => Buffer.from(saved),
  };
  const agent = { session: { header: { cwd: '/workspace' } }, ctx: { get: key => ({ fs,
    sessionProjections: { stateOf: () => ({ openTurnStartSeq: 1, lastTurn: 1 }) } })[key] } };
  const exec = { agent, signal: new AbortController().signal };
  const output = await exportFasta({ tool: 'sequence_fetch', result }, args, exec);
  assert.equal(output.result.file.verified, true);
  assert.equal(output.delivery.files.length, 1);
  assert.equal(output.result.result.sequences[0].sequence, undefined);
  fs.readBytes = async () => Buffer.from('damaged');
  await assert.rejects(exportFasta({ result }, args, exec), /SDH_FILE_INTEGRITY/);
  await assert.rejects(exportFasta({ result }, args, { signal: exec.signal }), /SDH_EXPORT_UNAVAILABLE/);
});
test('labels not_found and context resolution independently of execution success', async () => {
  for (const [tool, result] of [['gene_resolve', { status: 'not_found' }], ['gene_context', { resolution: { status: 'ambiguous' }, context: null }]]) {
    const value = await createClient({}, async () => new Response(JSON.stringify({ tool, status: 'ok', result }), { headers: { 'content-type': 'application/json' } }))(tool, { gene_id: args.gene_id, species: args.species, version: args.version });
    assert.equal(value.executionStatus, 'ok');
    assert.equal(value.businessStatus, result.status ?? result.resolution.status);
  }
});
