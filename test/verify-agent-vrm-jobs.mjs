import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStudioTools} from '../bin/agent/studio-tools.mjs';
import {readVrmJob} from '../src/vrm-generation.js';
const host={workspaceId:'tab',documentEpoch:'doc',sceneId:'scene',sceneEpoch:'epoch'};
let revision=1,started=0;const calls=[];
const admission={host,revision,commandId:randomUUID,refresh:async()=>{throw Error('Unexpected refresh');}};
const liveHub={command:async(name,payload,workspace,options)=>{
  calls.push({name,payload,workspace,options});assert.equal(workspace,'handle');
  const action=payload.args.action;
  assert.equal(payload.expectedRevision,revision);
  if(action==='character.generateVrm'){
    started++;assert.equal(options.timeoutMs,6000,'transport outlives the 1-second editor detachment');
    return {ok:true,status:'started',jobId:'f33f96b9-ecc8-497c-bd15-11053a2bd471',revision:{before:revision,after:revision}};
  }
  assert.equal(action,'job.await');assert.equal(payload.args.args.jobId,'f33f96b9-ecc8-497c-bd15-11053a2bd471');
  assert.equal(options.timeoutMs,300000);const before=revision++;
  return {ok:true,status:'completed',host,revision:{before,after:revision},output:{jobId:`job_avatar${started}`,characterId:`avatar${started}`}};
}};
const tools=createStudioTools({liveHub,workspaceHandle:'handle',session:{admission,actionIndex:[{id:'character.generateVrm',timeoutMs:1000}]}});
for(const name of ['Lina','Noé']){
  const result=await tools.internal.invoke('run_action',{action:'character.generateVrm',args:{name,prompt:`Create ${name}`}});
  assert.equal(result.status,'completed');assert(result.output.jobId.startsWith('job_'));
}
assert.equal(started,2,'both requested avatars can complete in one turn');assert.equal(admission.revision,3);
assert.equal(new Set(calls.map(call=>call.payload.commandId)).size,4,'await has its own command ID');
const prior=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Wrong job ID reached HTTP');};
try {await assert.rejects(readVrmJob('f33f96b9-ecc8-497c-bd15-11053a2bd471'),error=>error.code==='INVALID_ARGUMENT' && error.message.includes('job.await'));}
finally{globalThis.fetch=prior;}
console.log('PASS agent VRM jobs: automatic correlated await, safe transport deadline, two avatars, revision chain and no UUID sent to Atelier');
