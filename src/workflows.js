import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';

const token = v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const taskPattern = { plot: /^plot-[a-f0-9]{32}$/, locus: /^pred-[a-f0-9]{32}$/ };
const states = { plot: ['queued','running','validating','succeeded','empty','failed','cancelled','expired'], locus: ['queued','running','paused','succeeded','failed','cancelled'] };
export const artifactTypes = { 'figure.png':'image/png', 'figure.pdf':'application/pdf', 'figure.svg':'image/svg+xml', 'figure.tiff':'image/tiff', 'plot-data.json':'application/json', 'manifest.json':'application/json', 'request.json':'application/json', 'caption.txt':'text/plain', 'sessionInfo.txt':'text/plain', 'runtime.json':'application/json' };
const fail = code => { throw new Error(`SDH_WORKFLOW_${code}`); };
const clean = value => {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k])=>!['csrf','grant','cookie','authorization'].includes(k.toLowerCase())).map(([k,v])=>[k,clean(v)]));
  return value;
};

// One website cookie jar per DSH conversation, never shared with another session
// or exposed to the model. No DSH model key or invented trial identity is sent.
export function createWorkflows(config = {}, fetchImpl = fetch) {
  const base = new URL(config.baseUrl ?? 'https://sci.hainanu.edu.cn/strawberry/');
  if (base.username || base.password || base.search || base.hash || !(base.protocol === 'https:' || base.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(base.hostname))) fail('CONFIG');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const sessions = new WeakMap();
  function session(owner) {
    if (!owner || typeof owner !== 'object') fail('SESSION_REQUIRED');
    let s=sessions.get(owner);
    if (!s) { s={id:randomUUID(),cookies:new Map(),drafts:new Map(),tasks:new Map(),busy:false}; sessions.set(owner,s); }
    return s;
  }
  async function request(s,path,body,signal,csrf,kind,binary=false) {
    const headers={Accept:binary?'*/*':'application/json'};
    if (s.cookies.size) headers.Cookie=[...s.cookies].map(([k,v])=>`${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type']='application/json';
    if (csrf) headers[kind==='plot'?'X-SDH-Plot-CSRF':'X-SDH-Prediction-CSRF']=csrf;
    let response;
    try {
      response=await fetchImpl(new URL(path,base), {method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)});
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const pair=line.split(';')[0], i=pair.indexOf('=');
        if(i>0 && /^[A-Za-z0-9_-]+$/.test(pair.slice(0,i)) && !/[\r\n]/.test(pair)) s.cookies.set(pair.slice(0,i),pair.slice(i+1));
      }
      if(!response.ok){await response.body?.cancel();fail(`HTTP_${response.status}: Request unavailable; no automatic retry. Website trial limits and session permissions apply.`);}
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>(binary?20*1024*1024:1024*1024))fail('RESPONSE_TOO_LARGE');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);
      if(binary)return {bytes,mime:response.headers.get('content-type')?.split(';')[0],sha256:response.headers.get('x-content-sha256')};
      if(!response.headers.get('content-type')?.includes('application/json'))fail('PROTOCOL');
      return JSON.parse(bytes.toString('utf8'));
    }catch(e){if(e.message?.startsWith('SDH_WORKFLOW_'))throw e;fail('TRANSPORT: Outcome may be unknown. Do not prepare or submit a replacement automatically.');}
  }
  async function locked(s,work){if(s.busy)fail('BUSY');s.busy=true;try{return await work();}finally{s.busy=false;}}
  function draft(s,id){const d=s.drafts.get(id);if(!d)fail('DRAFT_NOT_IN_SESSION');if(Date.now()>=d.expiresAt)fail('DRAFT_EXPIRED');return d;}
  function checkStatus(kind,value,expected) {
    const id=kind==='plot'?value.id:value.taskId,state=kind==='plot'?value.state:value.status;
    if(!taskPattern[kind].test(id)||expected&&id!==expected||!states[kind].includes(state))fail('TASK_PROTOCOL');
    return {id,state};
  }
  const prefix=kind=>kind==='plot'?'api/v1/ai/plots/':'api/v1/ai/predictions/';
  return {
    async prepare(owner,kind,question,signal){
      if(!['plot','locus'].includes(kind)||typeof question!=='string'||!question.trim()||question.length>4000)fail('INPUT');
      const s=session(owner);return locked(s,async()=>{
        // Never replay an ambiguous preparation; a new explicit user request is needed.
        const key=kind+':'+question.trim();
        if(s.lastPrepare===key)fail('DUPLICATE_PREPARATION: Inspect the existing draft or clarify the request.');
        s.lastPrepare=key;
        for(const [id,d]of s.drafts)if(Date.now()>=d.expiresAt)s.drafts.delete(id);
        if(s.drafts.size>=16)fail('DRAFT_LIMIT');
        const response=await request(s,'api/v1/ai/agent/chat',{sessionId:s.id,question:question.trim(),messages:[],interactionMode:'agent'},signal);
        const tool=response.tools?.find(t=>t.name===(kind==='plot'?'berryplot_prepare':'genome_prediction_prepare')&&t.status==='ok');
        const r=tool?.result,c=r?.confirmation;
        const expiresAt=kind==='plot'?Number(c?.expiresAt)*1000:Date.parse(c?.expiresAt);
        if(!token(c?.grant)||!token(c?.csrf)||!Number.isFinite(expiresAt)||expiresAt<=Date.now())return {status:'not_prepared',computationStarted:false,response:clean(response),websiteUrl:new URL('ai.html',base).href,notice:'No valid task grant returned. Credential fields are omitted; source digests refer to the original server results before redaction.'};
        if(kind==='plot'?(r.computationStarted!==false||c.state!=='awaiting_confirmation'):(r.operation!=='prepare'||r.data?.computationStarted!==false||r.data?.status!=='awaiting_confirmation'))fail('DRAFT_PROTOCOL');
        const id=randomUUID();s.drafts.set(id,{kind,grant:c.grant,csrf:c.csrf,expiresAt,summary:clean(r),taskId:null});
        return {status:'awaiting_confirmation',draftId:id,expiresAt:new Date(expiresAt).toISOString(),computationStarted:false,summary:clean(r),notice:'Review this exact draft; sdh_task_confirm requires DSH approval. A draft is not a completed result. Website quota applies to preparation.'};
      });
    },
    summary(owner,id){return draft(session(owner),id).summary;},
    async confirm(owner,id,signal){const s=session(owner);return locked(s,async()=>{
      const d=draft(s,id);
      const r=await request(s,prefix(d.kind)+(d.taskId?d.taskId:'confirm'),d.taskId?undefined:{grant:d.grant},signal,d.csrf,d.kind);
      const checked=checkStatus(d.kind,r,d.taskId);d.taskId=checked.id;s.tasks.set(checked.id,{kind:d.kind,csrf:d.csrf});
      return {kind:d.kind,taskId:checked.id,state:checked.state,result:clean(r),notice:'Poll this existing task; do not submit a replacement. A queued task is not a completed result.'};
    });},
    async status(owner,id,signal){const s=session(owner);return locked(s,async()=>{
      const t=s.tasks.get(id);if(!t)fail('TASK_NOT_IN_SESSION');
      const r=await request(s,prefix(t.kind)+id,undefined,signal,t.csrf,t.kind);const c=checkStatus(t.kind,r,id);
      return {kind:t.kind,taskId:id,state:c.state,result:clean(r)};
    });},
    async result(owner,id,signal){const s=session(owner);return locked(s,async()=>{
      const t=s.tasks.get(id);if(!t||t.kind!=='locus')fail('PREDICTION_NOT_IN_SESSION');
      const status=await request(s,prefix(t.kind)+id,undefined,signal,t.csrf,t.kind);
      if(checkStatus(t.kind,status,id).state!=='succeeded')fail('NOT_COMPLETE');
      return clean(await request(s,prefix(t.kind)+id+'/result',undefined,signal,t.csrf,t.kind));
    });},
    async artifact(owner,id,name,signal){const s=session(owner);return locked(s,async()=>{
      const t=s.tasks.get(id);if(!t||t.kind!=='plot'||!Object.hasOwn(artifactTypes,name))fail('ARTIFACT_INPUT');
      const status=await request(s,prefix(t.kind)+id,undefined,signal,t.csrf,t.kind);
      if(!['succeeded','empty'].includes(checkStatus(t.kind,status,id).state))fail('NOT_COMPLETE');
      const r=await request(s,prefix(t.kind)+id+'/artifacts/'+name,undefined,signal,t.csrf,t.kind,true);
      if(r.mime!==artifactTypes[name]||!/^[a-f0-9]{64}$/.test(r.sha256)||createHash('sha256').update(r.bytes).digest('hex')!==r.sha256)fail('ARTIFACT_INTEGRITY');
      return {...r,name};
    });},
  };
}

// Bounded, ephemeral loopback downloads; credentials and task actions are never
// served. Browser access cannot create jobs. Restart/expiry clears these files.
export function createArtifactDownloads() {
  const files=new Map();let server,starting;
  return {
    async add(file){
      for(const [id,f]of files)if(Date.now()>f.expiresAt)files.delete(id);
      if(files.size>=8)fail('DOWNLOAD_LIMIT');
      if(!starting) starting=new Promise((resolve,reject)=>{
        server=createServer((req,res)=>{
          const f=files.get(req.url);
          if(req.method!=='GET'||!f||Date.now()>f.expiresAt){res.writeHead(404);res.end();return;}
          res.writeHead(200,{'Content-Type':f.mime,'Content-Length':f.bytes.length,'Content-Disposition':`attachment; filename="${f.name}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});res.end(f.bytes);
        });server.once('error',reject);server.listen(0,'127.0.0.1',resolve);server.unref();
      });
      await starting;const route='/'+randomUUID()+'/'+file.name;files.set(route,{...file,expiresAt:Date.now()+15*60*1000});
      return {downloadUrl:`http://127.0.0.1:${server.address().port}${route}`,filename:file.name,bytes:file.bytes.length,sha256:file.sha256,expiresInSeconds:900};
    },
    close(){files.clear();server?.close();},
  };
}
