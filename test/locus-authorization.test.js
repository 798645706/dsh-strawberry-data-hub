import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWorkflows} from '../src/workflows.js';
const csrf='c'.repeat(43),grant='g'.repeat(43),task='pred-'+'a'.repeat(32);
const plan={assemblyId:'sdh-asm-978dddb4-a7d0-5230-9646-f5bc3f7b2e33',releaseId:'fixture',methodId:'sdh-dna-'+'a'.repeat(64),contig:'chr1',position:10001,coordinateSystem:'1-based',ref:'T',alt:'A'};
const draft=()=>({modelRequired:false,operation:'prepare',data:{status:'awaiting_confirmation',computationStarted:false,request:plan},confirmation:{csrf,grant,expiresAt:new Date(Date.now()+600000).toISOString()}});
test('structured SNV authorization preserves session and confirmation with zero website chat calls',async()=>{
 let submits=0;const paths=[];const w=createWorkflows({},async(u,o)=>{
  paths.push(u.pathname);assert.ok(u.pathname.includes('/predictions/'));assert.equal(o.headers['X-SDH-AI-Key'],undefined);assert.equal(o.headers['X-SDH-Trial-Id'],undefined);
  if(u.pathname.endsWith('/session')){assert.equal(o.headers['X-SDH-Prediction-Client'],'dsh-v1');return Response.json({csrf,modelRequired:false},{headers:{'set-cookie':'JSESSIONID=locus-private'}});}
  assert.equal(o.headers.Cookie,'JSESSIONID=locus-private');assert.equal(o.headers['X-SDH-Prediction-CSRF'],csrf);
  if(u.pathname.endsWith('/catalogue')){assert.equal(u.searchParams.get('query'),'Camarosa');return Response.json({method:{methodId:plan.methodId},references:[]});}
  if(u.pathname.endsWith('/prepare')){assert.deepEqual(JSON.parse(o.body),plan);return Response.json(draft());}
  if(u.pathname.endsWith('/confirm')){submits++;assert.deepEqual(JSON.parse(o.body),{grant});}
  if(u.pathname.endsWith('/result'))return Response.json({status:'ready',data:{scientificValidation:false}});
  return Response.json({taskId:task,status:'succeeded'});
 });
 const owner={};await w.locusCatalogue(owner,'Camarosa');const d=await w.prepareLocus(owner,plan);assert.equal(submits,0);assert.equal(d.modelRequired,false);assert.ok(!JSON.stringify(d).includes(grant));
 await assert.rejects(w.confirm({},d.draftId),/NOT_IN_SESSION/);await w.confirm(owner,d.draftId);await w.confirm(owner,d.draftId);assert.equal(submits,1);
 assert.equal((await w.result(owner,task)).data.scientificValidation,false);assert.ok(paths.length>=6);
});
test('SNV validation fails before transport for missing, unsafe or mixed coordinate inputs',async()=>{
 let calls=0;const w=createWorkflows({},async()=>{calls++;throw Error('Unexpected');});
 for(const p of [{...plan,position:0},{...plan,position:1.1},{...plan,ref:'T',alt:'T'},{...plan,coordinateSystem:'0-based'},{...plan,owner:'x'},{...plan,contig:'../x'},{...plan,methodId:'unknown'}])await assert.rejects(w.prepareLocus({},p),/INPUT/);
 assert.equal(calls,0);
});
test('rejected SNV can be explicitly retried but an ambiguous preparation cannot',async()=>{
 for(const ambiguous of [false,true]){let calls=0;const w=createWorkflows({},async u=>{if(u.pathname.endsWith('/session'))return Response.json({csrf,modelRequired:false});calls++;if(ambiguous)throw Error('network');return calls===1?Response.json({}, {status:429}):Response.json(draft());});
  const owner={};await assert.rejects(w.prepareLocus(owner,plan),ambiguous?/TRANSPORT/:/HTTP_429/);assert.equal(calls,1);
  if(ambiguous){await assert.rejects(w.prepareLocus(owner,plan),/DUPLICATE/);assert.equal(calls,1);}else assert.equal((await w.prepareLocus(owner,plan)).status,'awaiting_confirmation');
 }
});
test('all published transports exclude website model chat and model credential forwarding',()=>{
 for(const file of ['../src/client.js','../src/workflows.js']){
  const source=readFileSync(new URL(file,import.meta.url),'utf8');assert.doesNotMatch(source,/api\/v1\/ai\/agent\/chat|X-SDH-AI-Key|X-SDH-AI-Provider|X-SDH-Trial-Id/);
 }
});
test('catalogue transport error does not imply a submitted task and permits the same read again',async()=>{
 let calls=0;const w=createWorkflows({},async u=>{if(u.pathname.endsWith('/session'))return Response.json({csrf,modelRequired:false});calls++;if(calls===1)throw Error('network');return Response.json({references:[]});});
 const owner={};await assert.rejects(w.locusCatalogue(owner,'Camarosa'),/READ_TRANSPORT.*did not submit computation/);
 assert.deepEqual(await w.locusCatalogue(owner,'Camarosa'),{references:[]});assert.equal(calls,2);
});
