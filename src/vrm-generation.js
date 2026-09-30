import {meshIdForBytes,openAssetDb,putAsset,ASSET_MAX_SOURCE_BYTES} from './scene-assets.js';

const apiBase=import.meta.env?.VITE_CCLAY_VRM_API_URL || '/vrm-api';
const storageKey='cozyclay.vrm-jobs.v1';
let jobs=[];
try {const saved=JSON.parse(localStorage.getItem(storageKey));if(Array.isArray(saved))jobs=saved.filter(row=>validJobId(row.jobId)).slice(-20);} catch {}
const listeners=new Set();
export const vrmJobsSnapshot=()=>jobs;
export const subscribeVrmJobs=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
function update(jobId,patch) {
  const prior=jobs.find(row=>row.jobId===jobId) ?? {jobId};
  jobs=[...jobs.filter(row=>row.jobId!==jobId),{...prior,...patch}].slice(-20);
  try {localStorage.setItem(storageKey,JSON.stringify(jobs));}catch {}
  for(const listener of listeners)listener();
}
export function validJobId(id){return typeof id==='string' && /^job_[A-Za-z0-9_-]{1,124}$/.test(id);}
const error=(code,message)=>Object.assign(new Error(message),{code});
const route=id=>{if(!validJobId(id))throw error('INVALID_ARGUMENT','Atelier requires its external job_… ID. A CozyClay receipt UUID must be awaited with job.await, never sent to the Atelier API. Read vrm.jobs to find the external ID.');return `/api/v1/jobs/${encodeURIComponent(id)}`;};
async function json(path,options={}) {
  let response;
  try {response=await fetch(`${apiBase.replace(/\/$/,'')}${path}`,{...options,signal:options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)});}
  catch(e){if(options.signal?.aborted)throw options.signal.reason;throw error('TARGET_NOT_READY',`Atelier VRM API unavailable: ${e.message}`);}
  let value;
  try {value=await response.json();}catch{throw error('TARGET_NOT_READY','The VRM API did not return JSON. Check its address and the Studio proxy.');}
  if(!response.ok)throw error(response.status===422?'INVALID_ARGUMENT':'TARGET_NOT_READY',String(value.error?.message ?? value.error ?? value.detail ?? `VRM API HTTP ${response.status}`).slice(0,1500));
  return value;
}
export async function readVrmJob(jobId,{signal}={}) {
  const result=await json(route(jobId),{signal});
  if(!['queued','processing','completed','failed'].includes(result.status))throw error('TARGET_NOT_READY','Unknown VRM job state returned by Atelier.');
  const job={jobId,status:result.status,progress:Number.isFinite(result.progress)?Math.max(0,Math.min(100,result.progress)):null,
    step:typeof result.step==='string'?result.step.slice(0,200):result.status,error:typeof result.error==='string'?result.error.slice(0,1500):null};
  update(jobId,job);return job;
}
function wait(ms,signal){return new Promise((resolve,reject)=>{
  signal?.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});
});}
export function validateVrmBytes(bytes) {
  if(!(bytes instanceof ArrayBuffer) || bytes.byteLength<20 || bytes.byteLength>ASSET_MAX_SOURCE_BYTES)throw error('INVALID_ARGUMENT','Generated VRM is empty or exceeds 32 MiB.');
  const view=new DataView(bytes);
  if(view.getUint32(0,true)!==0x46546c67 || view.getUint32(4,true)!==2 || view.getUint32(8,true)!==bytes.byteLength || view.getUint32(16,true)!==0x4e4f534a)throw error('INVALID_ARGUMENT','The API download is not a valid binary glTF 2 avatar.');
  const size=view.getUint32(12,true);
  if(size>bytes.byteLength-20)throw error('INVALID_ARGUMENT','Truncated VRM JSON chunk.');
  let document;try{document=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,size)));}catch{throw error('INVALID_ARGUMENT','Invalid VRM JSON chunk.');}
  const humanoid=document.extensions?.VRMC_vrm?.humanoid?.humanBones ?? document.extensions?.VRM?.humanoid?.humanBones;
  if(!humanoid || (!Array.isArray(humanoid) && !humanoid.hips) || (Array.isArray(humanoid) && !humanoid.some(row=>row.bone==='hips')))throw error('INVALID_ARGUMENT','Generated file has no VRM humanoid with hips.');
  return document;
}
export async function storeGeneratedVrm(bytes,name) {
  validateVrmBytes(bytes);
  const assetId=await meshIdForBytes(bytes),db=await openAssetDb();
  try {await putAsset(db,{id:assetId,type:'model/gltf-binary',bytes,name:`${name}.vrm`,role:'vrm-character'});}finally{db.close?.();}
  return {assetId,modelId:`vrm-${assetId}`};
}
export async function generateVrmAsset(args,{signal,check=()=>{},store=storeGeneratedVrm}={}) {
  let jobId=args.jobId,interval=1000;
  if(!jobId) {
    const payload=Object.fromEntries(['prompt','name','author','gender','model'].filter(key=>args[key]!==undefined).map(key=>[key,args[key]]));
    const accepted=await json('/api/v1/jobs/text-to-vrm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});
    jobId=accepted.job_id;
    if(!validJobId(jobId))throw error('TARGET_NOT_READY','Atelier accepted the request without a valid job_id. Do not resubmit automatically.');
    interval=Number.isFinite(accepted.check_interval_ms)?Math.max(500,Math.min(5000,accepted.check_interval_ms)):1000;
  }
  update(jobId,{name:args.name,status:'queued',progress:null,step:'tracking',error:null});
  try {
    for(;;) {
      signal?.throwIfAborted();check();
      const job=await readVrmJob(jobId,{signal});
      if(job.status==='failed')throw error('TARGET_NOT_READY',`VRM job ${jobId} failed: ${job.error || 'No reason provided.'}`);
      if(job.status==='completed')break;
      await wait(interval,signal);
    }
    check();update(jobId,{step:'downloading'});
    const response=await fetch(`${apiBase.replace(/\/$/,'')}${route(jobId)}/download`,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
    if(!response.ok)throw error('TARGET_NOT_READY',`VRM download failed (HTTP ${response.status}). Resume job ${jobId} instead of generating again.`);
    const length=Number(response.headers.get('content-length'));
    if(length>ASSET_MAX_SOURCE_BYTES)throw error('INVALID_ARGUMENT','Generated VRM exceeds 32 MiB.');
    const bytes=await response.arrayBuffer();validateVrmBytes(bytes);check();
    update(jobId,{step:'importing'});
    const asset=await store(bytes,args.name);check();
    return {...asset,jobId};
  } catch(e){update(jobId,{error:`${e.message} Resume/import job ${jobId} when available.`,step:signal?.aborted?'tracking_stopped':'error'});throw e;}
}
export const finishVrmImport=(jobId,characterId)=>update(jobId,{characterId,installed:true,step:'installed',error:null});
export const markVrmImportError=(jobId,e)=>update(jobId,{step:'import_error',error:e.message});
