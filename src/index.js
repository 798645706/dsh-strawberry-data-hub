import { defineTool } from '@deepseek-ai/dsh-tools';
import { contracts } from './contracts.js';
import { createClient } from './client.js';
import { exportFasta, renderResult } from './export.js';
import { validateArguments } from './contracts.js';
import { scientificGuidance } from './science.js';
import { createEvidenceChecks, checkParameters, checkDescription } from './evidence-check.js';

export const name = 'strawberry-data-hub';
export const inject = ['tools', 'systemPrompt'];
export function apply(ctx, config = {}) {
  ctx.systemPrompt.section({ name: 'strawberry-data-hub:scientific-evidence', order: 4500, text: scientificGuidance });
  const call = createClient(config);
  const evidenceChecks = createEvidenceChecks();
  const pending = new WeakMap();
  // Explicit opt-in for a dedicated research profile, not an implicit restriction
  // on unrelated tools in a user's general-purpose DSH installation.
  if (config.researchOnly === true) {
    const allowed = new Set([...contracts.map(c => `sdh_${c.backend}`), 'sdh_sequence_export', 'sdh_evidence_check', 'ask_user_question']);
    ctx.tools.guard(exec => allowed.has(exec.name) ? undefined
      : 'SDH_RESEARCH_ONLY: This dedicated profile permits only SDH tools and ask_user_question. Report limits or missing capabilities to the user; do not use shell, web or generic file tools.');
  }
  for (const contract of contracts) {
    ctx.tools.register(defineTool({
      name: `sdh_${contract.backend}`,
      description: contract.description,
      parameters: contract.parameters,
      output: { schema: { type: 'json' }, render: (_args, value) => renderResult(value) },
      async execute(args, exec) {
        const value = await call(contract.backend, args, exec.signal);
        if (contract.backend === 'literature_search') value.evidenceSnapshot = evidenceChecks.remember(exec.agent?.session, value);
        return value;
      },
    }));
  }
  ctx.tools.register(defineTool({
    name: 'sdh_evidence_check', description: checkDescription, parameters: checkParameters,
    output: { schema: { type: 'json' }, render: (_args, value) => renderResult(value) },
    async execute(input, exec) { exec.signal.throwIfAborted(); return evidenceChecks.check(exec.agent?.session, input); },
  }));
  ctx.tools.register(defineTool({
    name: 'sdh_sequence_export',
    description: 'Create and deliver a verified FASTA download in the current DSH workspace when the user requests a sequence file. Fetches original server sequence directly; never uses model-generated sequence text. Writes one new uniquely named file, never overwrites. Automatically presents the file; do not call present again. Include the returned file.downloadUrl as a Markdown link in Web responses. Requires an exact gene/species/assembly key. Reports character count including stop symbols, residue count excluding them, sequence hash and complete file hash separately.',
    parameters: contracts.find(c => c.backend === 'sequence_fetch').parameters,
    output: { schema: { type: 'json' }, render: (_args, value) => renderResult(value) },
    async execute(input, exec) {
      const args = validateArguments('sequence_fetch', input);
      const value = await call('sequence_fetch', args, exec.signal);
      const exported = await exportFasta(value, args, exec);
      pending.set(exec, exported.delivery);
      return exported.result;
    },
  }));
  ctx.on('tools/result', (exec, result) => {
    const delivery = pending.get(exec);
    pending.delete(exec);
    if (delivery && !result.isError) delivery.session.append('deliverables/presented', {
      turn: delivery.turn, callId: exec.callId, files: delivery.files,
    });
  });
}
