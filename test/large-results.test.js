import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createClient} from '../src/client.js';
import {createArtifactDownloads} from '../src/workflows.js';
test('missing operation parameters fail locally before HTTP',async()=>{
 let calls=0;const client=createClient({},async()=>{calls++;throw Error('Unexpected HTTP');});
 for(const [name,args] of [['metabolite_search',{operation:'statistics'}],['metabolite_search',{operation:'matrix'}],['metabolite_search',{operation:'feature_detail'}],['genome_evidence_query',{operation:'sequence',assembly_id:'a',release_id:'r',contig:'c',start:0,end:10,coordinate_system:'0-based-half-open'}]])await assert.rejects(client(name,args),/SDH_INVALID_ARGUMENT.*requires/);
 assert.equal(calls,0);
});
test('large matrix delivered losslessly without pretending model read omitted rows',async()=>{
 const raw=JSON.stringify({tool:'metabolite_search',status:'ok',result:{status:'ok',matrix:'A'.repeat(1100000)},provenance:{resultSha256:'original'}});
 const downloads=createArtifactDownloads();try{
 const client=createClient({deliverLargeResult:f=>downloads.add(f)},async()=>new Response(raw,{headers:{'content-type':'application/json'}}));
 const r=await client('metabolite_search',{operation:'matrix',assay:'fixture'});
 assert.equal(r.resultOmittedFromModel,true);assert.equal(r.result,undefined);assert.equal(r.provenance.resultSha256,'original');
 const bytes=Buffer.from(await(await fetch(r.file.downloadUrl)).arrayBuffer());assert.equal(bytes.toString(),raw);assert.equal(r.file.sha256,createHash('sha256').update(bytes).digest('hex'));
 }finally{downloads.close();}
});
test('oversized catalogue gets whole-file delivery while small catalogue stays inline',async()=>{
 let large=false,delivered=0;const client=createClient({deliverLargeResult:async f=>{delivered++;return {sha256:f.sha256};}},async()=>Response.json({tool:'data_catalog',status:'ok',result:{status:'ok',rows:large?'X'.repeat(61000):[]}}));
 assert.equal((await client('data_catalog',{})).result.status,'ok');large=true;assert.equal((await client('data_catalog',{domain:'all'})).resultOmittedFromModel,true);assert.equal(delivered,1);
});
