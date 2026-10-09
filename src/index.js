import { defineTool } from '@deepseek-ai/dsh-tools';
import { contracts } from './contracts.js';
import { createClient } from './client.js';
import { exportFasta, renderResult } from './export.js';
import { validateArguments } from './contracts.js';
import { scientificGuidance } from './science.js';
import { createEvidenceChecks, checkParameters, checkDescription } from './evidence-check.js';
import { createWorkflows, createArtifactDownloads, artifactTypes } from './workflows.js';

export const workflowNames = ['sdh_berryplot_prepare','sdh_berrylocus_prepare','sdh_task_confirm','sdh_task_status','sdh_prediction_result','sdh_plot_download'];

export const name = 'strawberry-data-hub';
export const inject = ['tools', 'systemPrompt'];
export function apply(ctx, config = {}) {
  ctx.systemPrompt.section({ name: 'strawberry-data-hub:scientific-evidence', order: 4500, text: scientificGuidance });
  const call = createClient(config);
  const evidenceChecks = createEvidenceChecks();
  const pending = new WeakMap();
  const workflows = createWorkflows(config);
  const downloads = createArtifactDownloads();
  ctx.on('dispose', () => downloads.close());
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next();
    if (decision.kind === 'deny') return decision;
    if (['sdh_berryplot_prepare','sdh_berrylocus_prepare'].includes(exec.name)) return {kind:'ask',reason:'Send this request to the SDH website to prepare a task. Website model/trial quota applies. No DSH model credentials are forwarded. Preparation does not start computation. Request: '+String(exec.arguments.question).slice(0,4000)};
    if (exec.name === 'sdh_task_confirm') {
      try { return {kind:'ask',reason:'Start this exact prepared server task after reviewing its data and settings: '+JSON.stringify(workflows.summary(exec.agent?.session,exec.arguments.draft_id))}; }
      catch { return {kind:'deny',reason:'No valid task draft in this session; prepare and review one first.'}; }
    }
    return decision;
  });
  const requiredText = description => ({type:'string',required:true,description});
  const registerWorkflow = (name, description, parameters, execute) => ctx.tools.register(defineTool({name,description,parameters,
    output:{schema:{type:'json'},render:(_args,value)=>renderResult(value)},
    async execute(args,exec){
      if(Object.keys(args).some(k=>!Object.hasOwn(parameters,k)))throw new Error('SDH_WORKFLOW_INPUT: Unknown parameter.');
      return execute(args,exec);
    }}));
  for (const kind of ['plot','locus']) registerWorkflow(kind==='plot'?'sdh_berryplot_prepare':'sdh_berrylocus_prepare',
    kind==='plot'?'Prepare a BerryPlot figure from an explicit user request (dataset, genes, plot type). Requires approval; uses website quota and a private session. Returns a reviewable draft, never a completed plot. No arbitrary code or invented data.':'Prepare a BerryLocus SNV prediction from explicit assembly/release/method, contig, 1-based position, REF and ALT. Discover these with read-only tools first. Requires approval and website quota; never infer missing alleles or submit automatically.',
    {question:requiredText('Exact complete user request, 1–4000 characters. Include explicit dataset/gene IDs or reference and SNV fields.')},
    (a,e)=>workflows.prepare(e.agent?.session,kind,a.question,e.signal));
  registerWorkflow('sdh_task_confirm','Submit one previously prepared BerryPlot/BerryLocus draft only after the native DSH approval. Reusing the draft reuses its server grant. Never prepare a new task to retry an uncertain submission.',
    {draft_id:requiredText('Exact draftId from this session.')},(a,e)=>workflows.confirm(e.agent?.session,a.draft_id,e.signal));
  registerWorkflow('sdh_task_status','Read an existing task from this DSH session. Queued/running is not completion. No automatic resubmission; do not poll in a tight loop.',
    {task_id:requiredText('Exact taskId returned by confirmation.')},(a,e)=>workflows.status(e.agent?.session,a.task_id,e.signal));
  registerWorkflow('sdh_prediction_result','Read a completed BerryLocus prediction from this session. Preserve model/reference identity and scientificValidation flags; LLR is model preference, not proven biological effect.',
    {task_id:requiredText('Exact completed prediction taskId.')},(a,e)=>workflows.result(e.agent?.session,a.task_id,e.signal));
  registerWorkflow('sdh_plot_download','Fetch a completed BerryPlot artifact, verify its SHA-256 and provide an expiring local download link. Return a Markdown link using downloadUrl; no raw binary enters model context. Links last 15 minutes and require this DSH process.',
    {task_id:requiredText('Exact plot taskId in this session.'),filename:{type:'string',required:true,enum:Object.keys(artifactTypes),description:'Requested output file.'}},
    async(a,e)=>downloads.add(await workflows.artifact(e.agent?.session,a.task_id,a.filename,e.signal)));
  // Explicit opt-in for a dedicated research profile, not an implicit restriction
  // on unrelated tools in a user's general-purpose DSH installation.
  if (config.researchOnly === true) {
    const allowed = new Set([...contracts.map(c => `sdh_${c.backend}`), ...workflowNames, 'sdh_sequence_export', 'sdh_evidence_check', 'ask_user_question']);
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
