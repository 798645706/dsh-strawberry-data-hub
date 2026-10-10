import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflows} from '../src/workflows.js';
const csrf='c'.repeat(43),grant='g'.repeat(43);
const plan={template:'expression_points',dataset:'fragaria-vesca-strawberry-atlas-2026',genes:['FvesChr6G00057790.1'],analysis:'',language:'zh'};
const result=()=>({computationStarted:false,confirmation:{csrf,grant,state:'awaiting_confirmation',expiresAt:Date.now()/1000+600},plan});
test('structured plot catalogue and preparation never call model chat or forward model keys',async()=>{
 const paths=[];const w=createWorkflows({},async(u,o)=>{paths.push(u.pathname);assert.equal(o.headers['X-SDH-AI-Key'],undefined);
  if(u.pathname.endsWith('/session')){assert.equal(o.headers['X-SDH-Plot-Client'],'dsh-v1');return Response.json({csrf,modelRequired:false},{headers:{'set-cookie':'JSESSIONID=private'}});}
  assert.equal(o.headers.Cookie,'JSESSIONID=private');assert.equal(o.headers['X-SDH-Plot-CSRF'],csrf);
  if(u.pathname.endsWith('/catalogue'))return Response.json({templates:['expression_points']});
  assert.deepEqual(JSON.parse(o.body),plan);return Response.json(result());
 });
 const owner={};await w.plotCatalogue(owner);const r=await w.preparePlot(owner,plan);
 assert.equal(r.modelRequired,false);assert.equal(r.status,'awaiting_confirmation');assert.equal(paths.length,3);assert.ok(paths.every(p=>p.includes('/plots/')));
 assert.ok(!JSON.stringify(r).includes(grant));await assert.rejects(w.confirm({},r.draftId),/NOT_IN_SESSION/);
});
test('definite rejection permits explicit retry; ambiguous transport remains blocked',async()=>{
 for(const status of [400,403,429]){let calls=0;const w=createWorkflows({},async u=>{if(u.pathname.endsWith('/session'))return Response.json({csrf,modelRequired:false});calls++;return calls===1?Response.json({}, {status}):Response.json(result());});
  const owner={};await assert.rejects(w.preparePlot(owner,plan),new RegExp('HTTP_'+status));assert.equal(calls,1);assert.equal((await w.preparePlot(owner,plan)).status,'awaiting_confirmation');assert.equal(calls,2);
 }
 let calls=0;const w=createWorkflows({},async u=>{if(u.pathname.endsWith('/session'))return Response.json({csrf,modelRequired:false});calls++;throw Error('network');});
 const owner={};await assert.rejects(w.preparePlot(owner,plan),/TRANSPORT/);await assert.rejects(w.preparePlot(owner,plan),/Local duplicate guard/);assert.equal(calls,1);
});
test('structured inputs reject arbitrary data and invalid genes before networking',async()=>{
 let calls=0;const w=createWorkflows({},async()=>{calls++;throw Error('Unexpected');});
 for(const input of [{...plan,source:{}},{...plan,genes:['../bad']},{...plan,template:'run_code'},{...plan,genes:['a','a']}])await assert.rejects(w.preparePlot({},input),/INPUT/);
 assert.equal(calls,0);
});
