import test from 'node:test';
import assert from 'node:assert/strict';
import { metaboliteMetrics, referenceMetrics, locusMetrics } from '../src/metrics.js';
import { createClient } from '../src/client.js';

test('metabolite counts distinguish source names, case, derivatives and missing names', () => {
  const features = [
    {id:'a',originalName:'Sucrose'}, {id:'b',originalName:'sucrose'},
    {id:'c',originalName:'Sucrose 6-phosphate'}, {id:'d',name:'Sucrose'},
    {id:'e',originalName:' Sucrose'}, {id:'f',originalName:'Sucrose'},
  ];
  const m=metaboliteMetrics({features},{query:'sucrose'});
  assert.equal(m.returnedFeatureCount,6); assert.equal(m.missingOriginalNameCount,1);
  assert.equal(m.exactQueryMatchCount,1);assert.equal(m.caseInsensitiveQueryMatchCount,3);
  assert.deepEqual(m.originalNameGroups.find(g=>g.originalName==='Sucrose'),{originalName:'Sucrose',count:2,featureIds:['a','f']});
  assert.equal(metaboliteMetrics({features},{}).exactQueryMatchCount,null);
  assert.equal(metaboliteMetrics({features:[]},{query:'Sucrose'}).exactQueryMatchCount,0);
  assert.equal(metaboliteMetrics({},{}),undefined);
});

test('catalogue metrics preserve page versus total and distinct releases without guessed deduplication', () => {
  const items=[{assemblyId:'a',releaseId:'r1',label:'primary'},{assemblyId:'a',releaseId:'r2',label:'primary'}];
  const m=referenceMetrics('genome_evidence_query',{data:{items,total:4,truncated:true}},{operation:'assemblies'});
  assert.equal(m.returnedRowCount,2);assert.equal(m.matchingTotal,4);assert.equal(m.truncated,true);
  assert.deepEqual(m.references,items);
  assert.equal(referenceMetrics('data_catalog',{data:{items}},{operation:'assemblies'}),undefined);
  assert.equal(referenceMetrics('genome_evidence_query',{data:{items}},{operation:'tracks'}),undefined);
});

test('derived metrics preserve raw results and source digests through client', async () => {
  for(const [name,args,result,key] of [
    ['metabolite_search',{query:'sucrose'},{features:[{id:'a',originalName:'Sucrose'}]},'metaboliteMetrics'],
    ['genome_evidence_query',{operation:'assemblies'},{data:{items:[],total:0,truncated:false}},'referenceMetrics'],
  ]){
    const out=await createClient({},async()=>Response.json({tool:name,status:'ok',result,provenance:{resultSha256:'unchanged'}}))(name,args);
    assert.deepEqual(out.result,result);assert.equal(out.provenance.resultSha256,'unchanged');assert.ok(out[key]);
  }
});

test('locus spans use half-open coordinates without changing source', () => {
 const row={geneId:'g',interval:{start:24920,end:27233,coordinateSystem:'0-based-half-open'}};
 const result={data:{candidates:[row]}};const original=JSON.stringify(result);
 assert.equal(locusMetrics('genome_evidence_query',result,{operation:'locus'}).intervals[0].lengthBp,2313);
 assert.equal(JSON.stringify(result),original);
 for(const interval of [{start:1,end:1,coordinateSystem:'0-based-half-open'},{start:2,end:1,coordinateSystem:'0-based-half-open'},{start:1,end:2,coordinateSystem:'1-based'}]){
 const m=locusMetrics('genome_evidence_query',{data:{candidates:[{interval}]}},{operation:'locus'});
 assert.equal(m.intervals[0].lengthBp,interval.start===interval.end?0:null);
 }
});
