import { createClient } from '../src/client.js';
const call = createClient();
const key = { gene_id: 'FvesChr6G00057790.1', species: 'Fragaria vesca', version: 'v6.0(Horticulture Research. 2023)' };
const cases = [
  ['data_catalog', { domain: 'genome', summary_only: true, limit: 1 }],
  ['gene_resolve', key], ['gene_context', key],
  ['sequence_fetch', { ...key, type: 'protein' }],
  ['literature_search', { question: 'Which genes regulate strawberry anthocyanin accumulation?', limit: 1 }],
  ['gene_resolve', { gene_id: 'SDH_NONEXISTENT_TEST_20260928' }],
];
for (const [tool, args] of cases) {
  try {
    const result = await call(tool, args);
    console.log(JSON.stringify({ tool, case: args.gene_id ?? args.domain ?? 'literature',
      status: result.result.status ?? 'no-status-field', chars: JSON.stringify(result).length,
      resultKeys: Object.keys(result.result), answerReviewed: result.answerReviewed }));
  } catch (error) { console.error(tool, error.message); process.exitCode = 1; }
}
