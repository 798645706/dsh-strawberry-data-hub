// Real public read-only APIs; no generation calls and no task submission.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../src/client.js';
import { contracts } from '../src/contracts.js';
import snapshot from '../src/public-contracts.json' with { type: 'json' };

const fixtures = JSON.parse(readFileSync(new URL('../test/fixtures/public-examples-20261009.json', import.meta.url), 'utf8'));
const dir = new URL(`../artifacts/beta2-live-${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url);
mkdirSync(dir, { recursive: true });
const response = await fetch(snapshot.source);
assert.equal(response.ok, true);
const online = await response.json();
for (const spec of snapshot.tools) assert.deepEqual(online.find(t => t.name === spec.name)?.inputSchema, spec.inputSchema, `Contract drift: ${spec.name}`);
const cases = contracts.map(c => ({ id: c.backend, tool: c.backend, args: fixtures.find(t => t.name === c.backend).examples[0] }));
// Query specific bounded changes from the October 9 deployment as well as catalogues.
cases.push(
  { id: 'synteny-selection', tool: 'synteny_search', args: {} },
  { id: 'mirna-selection', tool: 'mirna_search', args: {} },
  { id: 'metabolite-sucrose', tool: 'metabolite_search', args: { query: 'sucrose' } },
  { id: 'sequence-toolkit', tool: 'sequence_analysis', args: { operation: 'toolkit', sequence: 'ATGGCC', sequence_type: 'dna' } },
  { id: 'sequence-orf', tool: 'sequence_analysis', args: { operation: 'orf_find', sequence: 'ATG' + 'GCC'.repeat(40), sequence_type: 'dna' } },
  { id: 'genome-assemblies', tool: 'genome_evidence_query', args: { operation: 'assemblies', query: 'Benihoppe', limit: 5 } },
  { id: 'prediction-references', tool: 'genome_prediction_prepare', args: { operation: 'catalog', query: 'Benihoppe' } },
  { id: 'missing-gene', tool: 'gene_resolve', args: { gene_id: 'SDH_NONEXISTENT_TEST_20261009' } },
);
const call = createClient();
const report = { startedAt: new Date().toISOString(), directory: dir.href, schemaMatches: snapshot.tools.length, cases: [] };
const requested = new Set(process.argv.slice(2));
for (const c of cases) {
  if (requested.size && !requested.has(c.id)) continue;
  // Public debug endpoint has an IP rate limit. Test pacing is not plugin retry.
  if (report.cases.length) await delay(6000);
  try {
    const result = await call(c.tool, c.args);
    assert.equal(result.executionStatus, 'ok');
    assert.equal(result.tool, c.tool);
    assert.equal(result.pluginVersion, '0.1.0-beta.2');
    if (c.id === 'missing-gene') assert.equal(result.result.status, 'not_found');
    writeFileSync(new URL(`${c.id}.json`, dir), JSON.stringify({ args: c.args, response: result }, null, 2));
    report.cases.push({ id: c.id, passed: true, businessStatus: result.businessStatus, chars: JSON.stringify(result).length, keys: Object.keys(result.result) });
  } catch (error) {
    report.cases.push({ id: c.id, passed: false, error: error.message });
    process.exitCode = 1;
  }
  console.log(JSON.stringify(report.cases.at(-1)));
  writeFileSync(new URL('report.json', dir), JSON.stringify(report, null, 2));
  if (report.cases.at(-1).error?.startsWith('SDH_HTTP_429')) break;
}
console.log(`Report: ${dir.href}`);
