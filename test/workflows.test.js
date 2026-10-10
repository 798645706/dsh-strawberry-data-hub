import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/index.js';
import { createWorkflows, createArtifactDownloads, plotDataPreview } from '../src/workflows.js';
const grant='g'.repeat(43),csrf='c'.repeat(43),plot='plot-'+'a'.repeat(32),pred='pred-'+'b'.repeat(32);
const plotPlan={template:'expression_heatmap',dataset:'fixture',genes:['g']};
const locusPlan={assemblyId:'sdh-asm-978dddb4-a7d0-5230-9646-f5bc3f7b2e33',releaseId:'fixture',methodId:'sdh-dna-'+'a'.repeat(64),contig:'chr1',position:10001,coordinateSystem:'1-based',ref:'T',alt:'A'};
function proposal(kind='plot') {
  const confirmation={grant,csrf,expiresAt:kind==='plot'?Date.now()/1000+900:new Date(Date.now()+900000).toISOString(),state:'awaiting_confirmation'};
  return {tools:[{name:kind==='plot'?'berryplot_prepare':'genome_prediction_prepare',status:'ok',result:kind==='plot'?{confirmation,plan:{template:'expression_heatmap',genes:['g'],dataset:'fixture'},computationStarted:false}:{confirmation,operation:'prepare',data:{status:'awaiting_confirmation',computationStarted:false}}}]};
}
test('workflow session isolation, grant privacy, confirmation reuse and checksum downloads',async()=>{
  const calls=[],bytes=Buffer.from('fixture');let confirmations=0;
  const api=createWorkflows({},async(url,opts)=>{
    calls.push({path:url.pathname,...opts});
    if(url.pathname.endsWith('/session'))return Response.json({csrf,modelRequired:false},{headers:{'set-cookie':'JSESSIONID=private; Path=/; Secure; HttpOnly'}});
    if(url.pathname.endsWith('/prepare'))return Response.json(proposal().tools[0].result);
    assert.equal(opts.headers.Cookie,'JSESSIONID=private');assert.equal(opts.headers['X-SDH-Plot-CSRF'],csrf);
    assert.equal(opts.headers['X-SDH-AI-Key'],undefined);assert.equal(opts.headers['X-SDH-Trial-Id'],undefined);
    if(url.pathname.endsWith('/confirm')){confirmations++;assert.equal(JSON.parse(opts.body).grant,grant);return Response.json({id:plot,state:'queued'});}
    if(url.pathname.includes('/artifacts/'))return new Response(bytes,{headers:{'content-type':'image/png','x-content-sha256':createHash('sha256').update(bytes).digest('hex')}});
    return Response.json({id:plot,state:'succeeded'});
  });
  const owner={},other={};const draft=await api.preparePlot(owner,plotPlan);
  assert.equal(JSON.stringify(draft).includes(grant),false);assert.equal(JSON.stringify(draft).includes(csrf),false);
  await assert.rejects(api.confirm(other,draft.draftId),/DRAFT_NOT_IN_SESSION/);
  const first=await api.confirm(owner,draft.draftId);assert.equal(first.state,'queued');
  assert.equal((await api.confirm(owner,draft.draftId)).state,'succeeded');assert.equal(confirmations,1);
  await assert.rejects(api.status(other,plot),/TASK_NOT_IN_SESSION/);
  const file=await api.artifact(owner,plot,'figure.png');assert.deepEqual(file.bytes,bytes);
  await assert.rejects(api.artifact(owner,plot,'../secret'),/ARTIFACT_INPUT/);
  await assert.rejects(api.preparePlot(owner,plotPlan),/DUPLICATE_PREPARATION/);
  assert.ok(calls.every(c=>c.redirect==='error'));
});
test('prediction lifecycle checks task identity and completion',async()=>{
  let done=false;
  const api=createWorkflows({},async(url)=>{
    if(url.pathname.endsWith('/session'))return Response.json({csrf,modelRequired:false});
    if(url.pathname.endsWith('/prepare'))return Response.json(proposal('locus').tools[0].result);
    if(url.pathname.endsWith('/result'))return Response.json({operation:'predictions',status:'ready',data:{scientificValidation:false}});
    return Response.json({taskId:pred,status:done?'succeeded':'queued'});
  });
  const owner={},d=await api.prepareLocus(owner,locusPlan);await api.confirm(owner,d.draftId);
  await assert.rejects(api.result(owner,pred),/NOT_COMPLETE/);done=true;
  assert.equal((await api.result(owner,pred)).data.scientificValidation,false);
});
test('quota, malformed preparation and network ambiguity never trigger automatic retries',async()=>{
  let calls=0;const api=createWorkflows({},async()=>{calls++;return Response.json({}, {status:429});});
  const owner={};await assert.rejects(api.preparePlot(owner,plotPlan),/HTTP_429/);assert.equal(calls,1);
  await assert.rejects(api.preparePlot(owner,plotPlan),/HTTP_429/);assert.equal(calls,2);
  const malformed=createWorkflows({},async()=>Response.json({tools:[]}));await assert.rejects(malformed.preparePlot({},plotPlan),/SESSION_PROTOCOL/);
});
test('corrupt artifact and mismatched task identity are rejected',async()=>{
  let mismatch=false;
  const api=createWorkflows({},async url=>{
    if(url.pathname.endsWith('/session'))return Response.json({csrf,modelRequired:false});
    if(url.pathname.endsWith('/prepare'))return Response.json(proposal().tools[0].result);
    if(url.pathname.includes('/artifacts/'))return new Response('corrupt',{headers:{'content-type':'image/png','x-content-sha256':'0'.repeat(64)}});
    return Response.json({id:mismatch?'plot-'+'f'.repeat(32):plot,state:'succeeded'});
  });
  const owner={},d=await api.preparePlot(owner,plotPlan);await api.confirm(owner,d.draftId);
  await assert.rejects(api.artifact(owner,plot,'figure.png'),/ARTIFACT_INTEGRITY/);mismatch=true;
  await assert.rejects(api.status(owner,plot),/TASK_PROTOCOL/);
});

test('ambiguous submission is never replayed automatically; explicit retry retains grant',async()=>{
  const bodies=[];const api=createWorkflows({},async(url,opts)=>{
    if(url.pathname.endsWith('/session'))return Response.json({csrf,modelRequired:false});
    if(url.pathname.endsWith('/prepare'))return Response.json(proposal().tools[0].result);
    bodies.push(JSON.parse(opts.body));
    if(bodies.length===1)throw new Error('private network detail');
    return Response.json({id:plot,state:'queued'});
  });
  const owner={},d=await api.preparePlot(owner,plotPlan);
  await assert.rejects(api.confirm(owner,d.draftId),e=>e.message.includes('TRANSPORT')&&!e.message.includes('private network detail'));
  assert.equal(bodies.length,1);
  await api.confirm(owner,d.draftId);assert.deepEqual(bodies,[{grant},{grant}]);
});
test('loopback artifact download provides exact bytes; unknown paths and POST cannot act',async()=>{
  const downloads=createArtifactDownloads();const bytes=Buffer.from('fixture');
  try{const file=await downloads.add({bytes,name:'figure.png',mime:'image/png',sha256:'fixture'});
    const r=await fetch(file.downloadUrl);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
    assert.match(r.headers.get('content-disposition'),/attachment/);
    assert.equal((await fetch(file.downloadUrl,{method:'POST'})).status,404);
    assert.equal((await fetch(new URL('/missing',file.downloadUrl))).status,404);
  }finally{downloads.close();}
});
test('native DSH refuses preparation without an approval service and refuses invented draft confirmation',async()=>{
  const ctx=new Context();try{
    await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime);await ctx.plugin(plugin,{researchOnly:true});
    for(const [name,args]of [['sdh_berryplot_prepare',{operation:'prepare',template:'expression_heatmap',dataset:'camarosa',genes:['g']}],['sdh_task_confirm',{draft_id:'invented'}]]){
      const r=await ctx.tools.execute({callId:name,name,arguments:args,signal:new AbortController().signal});assert.equal(r.isError,true);
    }
  }finally{ctx.registry.delete(plugin);ctx.registry.delete(ToolRuntime);ctx.registry.delete(SystemPrompt);}
});

test('native DSH approved preparation and separate confirmation preserve draft and session',async()=>{
  let requests=0, confirmations=0, allow=true;const approvals=[];
  const server=createServer(async(req,res)=>{
    requests++;let body='';for await(const chunk of req)body+=chunk;
    res.setHeader('Content-Type','application/json');
    if(req.url.endsWith('/session')){res.setHeader('Set-Cookie','JSESSIONID=fixture; Path=/');res.end(JSON.stringify({csrf,modelRequired:false}));return;}
    if(req.url.endsWith('/prepare')){assert.equal(req.headers['x-sdh-plot-csrf'],csrf);res.end(JSON.stringify(proposal().tools[0].result));return;}
    assert.equal(req.headers.cookie,'JSESSIONID=fixture');assert.equal(req.headers['x-sdh-plot-csrf'],csrf);
    if(req.url.endsWith('/confirm')){confirmations++;assert.equal(JSON.parse(body).grant,grant);}
    res.end(JSON.stringify({id:plot,state:'succeeded'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const ctx=new Context();
  try{
    ctx.provide('approval',{request:async request=>{approvals.push(request);return allow?'allowed-once':'rejected';}});
    await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime);await ctx.plugin(plugin,{baseUrl:`http://127.0.0.1:${server.address().port}/`,researchOnly:true});
    const agent={session:{}};
    const run=(name,args)=>ctx.tools.execute({callId:String(approvals.length),name,arguments:args,agent,signal:new AbortController().signal});
    const prepared=await run('sdh_berryplot_prepare',{operation:'prepare',template:'expression_heatmap',dataset:'camarosa',genes:['g']});
    assert.equal(prepared.isError,false,JSON.stringify(prepared));
    const d=JSON.parse(prepared.content[0].text);assert.equal(requests,2);assert.equal(confirmations,0);
    allow=false;assert.equal((await run('sdh_task_confirm',{draft_id:d.draftId})).isError,true);assert.equal(requests,2);
    allow=true;assert.equal((await run('sdh_task_confirm',{draft_id:d.draftId})).isError,false);assert.equal(confirmations,1);
    assert.equal(approvals.length,3);assert.match(approvals[2].reason,/expression_heatmap/);
    assert.equal(approvals[2].reason.includes(grant),false);assert.equal(approvals[2].reason.includes(csrf),false);
    const status=await run('sdh_task_status',{task_id:plot});assert.equal(status.isError,false);assert.equal(approvals.length,3);
  }finally{ctx.registry.delete(plugin);ctx.registry.delete(ToolRuntime);ctx.registry.delete(SystemPrompt);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('verified plot JSON preview preserves exact data and bounds context',()=>{
 const data={genes:['g'],samples:['s'],raw:[[0]],display:[[0]]};
 const file={name:'plot-data.json',bytes:Buffer.from(JSON.stringify(data)),sha256:'verified'};
 assert.deepEqual(plotDataPreview(file).data,data);
 assert.equal(plotDataPreview({...file,bytes:Buffer.alloc(24001)}).status,'download_only');
 assert.equal(plotDataPreview({...file,name:'figure.png'}),undefined);
 assert.throws(()=>plotDataPreview({...file,bytes:Buffer.from('bad')}),/ARTIFACT_JSON/);
});
