import {generateVrmAsset,readVrmJob,vrmJobsSnapshot,finishVrmImport,markVrmImportError} from '../vrm-generation.js';
import {createStableItemId} from '../stable-items.js';
import {fail} from './shared.js';
import {createCharacterEntry} from '../scenes.js';
const text=max=>({type:'string',minLength:1,maxLength:max});
const jobId={...text(128),pattern:'^job_[A-Za-z0-9_-]+$',description:'External Atelier ID, starting with job_. Never pass the CozyClay UUID from a started receipt here; that UUID is awaited with job.await.'};
const placement={type:'object',properties:{x:{type:'number',minimum:-240,maximum:240},z:{type:'number',minimum:-240,maximum:240},rot:{type:'number',minimum:-180,maximum:180}},required:[],additionalProperties:false};
const input=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
export const declarations=Object.freeze([
  {id:'character.generateVrm',label:'Generate VRM avatar',description:'Only on an explicit avatar generation request: submit text-to-VRM to Atelier, follow its job, store the VRM and add an animatable character. Repeat sequentially for several descriptions. Does not generate body motion.',kind:'job',domain:'cast',background:true,timeoutMs:1000,
    input:input({name:text(120),prompt:text(8000),gender:{type:'string',enum:['female','male']},author:text(120),model:text(120),placement},['name','prompt'])},
  {id:'character.importVrmJob',label:'Import generated VRM job',description:'Resume a known Atelier job and add its VRM to the current scene without starting another generation. Useful after a reload, timeout or scene change.',kind:'job',domain:'cast',background:true,timeoutMs:1000,input:input({jobId,name:text(120),placement},['jobId','name'])},
  {id:'vrm.jobs',label:'Read VRM generation jobs',description:'Read locally tracked Atelier jobs, their external job IDs, actual progress and import results. External generation can continue after local cancellation.',kind:'transient',input:input({})},
  {id:'vrm.status',label:'Read VRM job status',description:'Read one job from Atelier. This does not submit or import an avatar.',kind:'transient',timeoutMs:60000,input:input({jobId})},
]);
export function register(registry,ports) {
  for(const declaration of declarations)registry.register({...declaration,available:()=>Boolean(ports.storeDomain?.('cast')) || 'The scene cast is not mounted.',async run(args,context){
    if(declaration.id==='vrm.jobs')return {affectedIds:[],summary:'VRM generation jobs.',output:{jobs:structuredClone(vrmJobsSnapshot())}};
    if(declaration.id==='vrm.status')return {affectedIds:[],summary:'Atelier VRM job status.',output:await readVrmJob(args.jobId,{signal:context.signal})};
    if(!args.name.trim() || (args.prompt!==undefined && !args.prompt.trim()))fail('INVALID_ARGUMENT','Provide an avatar name and a nonempty description.');
    const asset=await generateVrmAsset(args,{signal:context.signal,check:()=>context.check()});
    const characterId=createStableItemId('character');
    try {context.commit(()=>{
      const owner=ports.storeDomain('cast');
      owner.write(rows=>{
        let position=args.placement;
        if(!position) {
          const candidates=Array.from({length:240},(_,index)=>({x:(index%120+1)*2*(index<120?1:-1),z:0}));
          position=candidates.find(point=>rows.every(row=>row.hidden || Math.hypot((row.x??0)-point.x,(row.z??0)-point.z)>=1.5));
          if(!position)fail('INVALID_ARGUMENT','No free default placement; specify placement for this VRM job.');
        }
        return [...rows,createCharacterEntry({id:characterId,model:asset.modelId,subject:args.name,...position},rows.length)];
      });
    });}
    catch(e){markVrmImportError(asset.jobId,e);throw e;}
    finishVrmImport(asset.jobId,characterId);
    return {affectedIds:[characterId],summary:`Generated VRM ${args.name} installed in the scene.`,output:{...asset,characterId}};
  }});
}
