import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProductionPilot,pilotTasks,pilotPrompt,requireVerification,issueText} from '../src/production/agent-pilot.js';
import {compile} from '../src/production/compiler.js';
import {createProductionDomain} from '../src/domains/production.js';
import {createAppContext} from '../src/app-context.js';
import {refusalEvent} from '../src/workflow/agent-client.js';

const source=()=>JSON.parse(readFileSync(new URL('./fixtures/production/narrative-v2.json',import.meta.url),'utf8'));
const proof=(check='placement')=>({type:'tool.done',name:'verify_result',ok:true,result:{stale:false,revision:1,checks:{[check]:{coverage:'measured'}},visualRefs:[{imageId:'captured-frame'}],unsupportedChecks:[]}});

test('issues display support placement and decisions as readable text',()=>{
 assert.equal(issueText({rule:'support-surface-placement',sourcePath:'/sets/ROOM/props/0',chosenValue:{x:1,y:0.75,z:2}}),'support-surface-placement · /sets/ROOM/props/0 : {"x":1,"y":0.75,"z":2}');
 assert.equal(issueText({question:'Missing contact?'}),'Missing contact?');
 assert.equal(issueText({code:'warning'}),'{"code":"warning"}');
});

test('pilot groups actor motion by scene and generates each avatar once',()=>{
 const tasks=pilotTasks(source());
 assert.equal(tasks.filter(t=>t.phase==='avatar').length,2);
 assert.equal(tasks.filter(t=>t.phase==='motion').length,2);
 assert.ok(tasks.findIndex(t=>t.phase==='avatar')>tasks.findLastIndex(t=>t.phase==='scene'));
 const doc={productionId:'p',planRevision:1,plan:compile(source()).plan.plan};
 const motion=pilotPrompt(tasks.find(t=>t.phase==='motion'),source(),doc);
 assert.ok(motion.includes('motion.generate'));
 assert.ok(motion.includes('SEULE prise continue'));
 assert.ok(motion.includes('API fournit des directives'));
 assert.ok(pilotPrompt(tasks.find(t=>t.phase==='avatar'),source(),doc).includes('character.generateVrm'));
 assert.ok(pilotPrompt(tasks.find(t=>t.phase==='layout'),source(),doc).includes('primitives natives'));
});

test('approximate VRM appearance and later-phase poses never block layout instructions',()=>{
 const s=source(),tasks=pilotTasks(s),doc={productionId:'p',planRevision:1,plan:compile(s).plan.plan};
 for(const phase of ['avatar','layout','verify']){
  const text=pilotPrompt(tasks.find(t=>t.phase===phase),s,doc);
  assert.ok(text.includes('TOUJOURS approximatifs'));
  assert.ok(text.includes('ne bloquent aucune étape'));
  assert.ok(text.includes('ne justifient jamais une régénération'));
  assert.ok(text.includes('modelId de chaque personnage'));
 }
 const layout=pilotPrompt(tasks.find(t=>t.phase==='layout'),s,doc);
 assert.ok(layout.includes('son absence AVANT ces phases ne bloque pas layout'));
 assert.ok(layout.includes('une collision involontaire d’un contact voulu'));
 assert.ok(layout.includes('au plus trois passes de correction'));
});

test('model prose, stale verification and unverified motion cannot complete a step',()=>{
 assert.throws(()=>requireVerification([{type:'text.delta',text:'Everything is done.'}],'layout'),/absente/);
 const stale=proof();stale.result.stale=true;
 assert.throws(()=>requireVerification([stale],'layout'),/absente/);
 const invisible=proof();invisible.result.visualRefs=[];
 assert.throws(()=>requireVerification([invisible],'layout'),/image/);
 const streamed=proof();delete streamed.name;streamed.callId='verify-call';
 assert.equal(requireVerification([{type:'tool.start',callId:'verify-call',name:'verify_result'},streamed],'layout').revision,1);
 assert.throws(()=>requireVerification([proof(),{type:'tool.done',ok:true,result:{authored:true}}],'layout'),/après/);
 const motion=proof();motion.result.verification={status:'unverified'};
 assert.throws(()=>requireVerification([motion],'motion'),/Kimodo/);
 motion.result.verification={status:'verified',range:{startFrame:0,endFrameExclusive:48}};
 assert.equal(requireVerification([motion],'motion').verification.status,'verified');
});

function fixture() {
 const domain=createProductionDomain(createAppContext());
 const s=source();domain.setSourceSnapshot(s);
 domain.writePlan(JSON.parse(JSON.stringify(compile(s).plan.plan)));
 const editor={activeSceneId:'initial',scenes:[],characters:[],objects:[],shots:[]};
 const calls=[];
 let failAt=null,stopRequest=null;
 const transport={
  async stop(request){stopRequest=request;},
  async turn(request,emit,signal){
   const data=JSON.parse(request.text.split('<production-data>')[1].split('</production-data>')[0]);
   const task=data.task;calls.push({task,request});
   if(task.id===failAt){emit({type:'error',message:'provider offline'});return;}
   if(task.phase==='scene'){
    const nativeEntityId='native-'+task.sceneId;editor.activeSceneId=nativeEntityId;editor.scenes.push({id:nativeEntityId});
    domain.patchBindings({[task.sceneId]:{nativeEntityId}});
   }else if(task.phase==='avatar'){
    emit({type:'tool.done',name:'run_action',ok:true,result:{output:{modelId:'vrm-'+task.characterId,assetId:'asset-'+task.characterId,jobId:'job_'+task.characterId,characterId:'created-'+task.characterId}}});
   }else{
    if(task.phase==='layout'){
     editor.characters=data.facts.characters.map(c=>({id:'native-'+task.sceneId+'-'+c.id,subject:c.name,model:data.generatedAvatars[c.id].modelId}));
     editor.objects=data.facts.set.props.map(p=>({id:'native-'+task.sceneId+'-'+p.id,name:p.name}));
    }
    if(task.phase==='cameras')editor.shots=data.facts.shots.map(shot=>({id:shot.id,startFrame:Math.round(shot.startSeconds*24),endFrame:Math.round(shot.endSeconds*24)-1}));
    const event=proof(task.phase==='cameras'?'framing':'placement');
    if(task.phase==='motion')event.result.verification={status:'verified'};
    if(task.phase==='verify'){
     event.result.checks.framing={coverage:'measured'};
     event.result.verification=[...new Set(data.facts.actions.filter(a=>a.kind!=='expression').map(a=>a.characterId))].map(()=>({status:'verified'}));
    }
    emit(event);
   }
   signal.throwIfAborted();
  }
 };
 const bus={async run(action,args){assert.equal(action,'scene.switch');assert.ok(args.sceneId);editor.activeSceneId=args.sceneId;return {ok:true};}};
 const pilot=createProductionPilot({domain,bus,transport,readEditor:()=>editor,buildContext:()=>({host:{sceneId:editor.activeSceneId},entities:[{id:'observed',token:editor.contextToken || 'old-token'}]})});
 return {domain,editor,calls,pilot,transport,setFailure:id=>{failAt=id;},get stopRequest(){return stopRequest;}};
}

test('HTTP refusal preserves the Studio stale code without changing the UI category',async()=>{
 const event=await refusalEvent(new Response(JSON.stringify({error:{code:'STALE_TARGET',message:'Content changed.'}}),{status:409}));
 assert.equal(event.code,'upstream');assert.equal(event.refusalCode,'STALE_TARGET');assert.equal(event.status,409);
});

test('admission conflict refreshes context and uses a new turn before any generation',async()=>{
 const f=fixture();try{
  const original=f.transport.turn;let refused=false;const attempts=[];
  f.transport.turn=async(request,emit,signal)=>{
   attempts.push(request);
   if(!refused){refused=true;f.editor.contextToken='fresh-token';emit({type:'error',...(await refusalEvent(new Response(JSON.stringify({error:{code:'STALE_TARGET',message:'Content changed.'}}),{status:409})))});emit({type:'done'});return;}
   return original(request,emit,signal);
  };
  await f.pilot.run({model:'provider/model'});
  assert.notEqual(attempts[0].turnId,attempts[1].turnId);
  assert.equal(attempts[0].context.entities[0].token,'old-token');
  assert.equal(attempts[1].context.entities[0].token,'fresh-token');
  assert.equal(attempts[0].sessionId,attempts[1].sessionId,'an unadmitted retry retains its phase session');
  assert.equal(f.calls.filter(c=>c.task.phase==='avatar').length,2);
  assert.equal(f.domain.read().agentExecution.status,'verified');
 }finally{f.domain.dispose();}
});

test('persistent admission conflict is bounded and never executes subsequent phases',async()=>{
 const f=fixture();try{
  let attempts=0;f.transport.turn=async(request,emit)=>{attempts++;emit({type:'error',status:409,refusalCode:'STALE_SCENE',message:'Content changed.'});emit({type:'done'});};
  await assert.rejects(f.pilot.run({model:'provider/model'}),/Content changed/);
  assert.equal(attempts,3);assert.equal(f.calls.length,0);
 }finally{f.domain.dispose();}
});

test('accepted tool activity and stream events forbid retrying a failed generation',async()=>{
 const f=fixture();try{
  let attempts=0;f.transport.turn=async(request,emit)=>{attempts++;emit({type:'tool.start',callId:'job',name:'run_action',eventSeq:1});emit({type:'error',status:409,refusalCode:'STALE_TARGET',message:'Job changed.',eventSeq:2});};
  await assert.rejects(f.pilot.run({model:'provider/model'}),/Job changed/);
  assert.equal(attempts,1);
 }finally{f.domain.dispose();}
});

test('admission retry never follows a manual switch into another scene',async()=>{
 const f=fixture();try{
  let attempts=0;f.transport.turn=async(request,emit)=>{attempts++;f.editor.activeSceneId='another-scene';emit({type:'error',status:409,refusalCode:'STALE_SCENE',message:'Content changed.'});emit({type:'done'});};
  await assert.rejects(f.pilot.run({model:'provider/model'}),/document ou la scène a changé/);
  assert.equal(attempts,1);
 }finally{f.domain.dispose();}
});

test('real immutable production store records verified phases, generated VRMs and bindings',async()=>{
 const f=fixture();try{
  await f.pilot.run({model:'provider/model',effort:'high'});
  const doc=f.domain.read();
  assert.equal(doc.agentExecution.status,'verified');
  assert.equal(doc.agentExecution.steps['layout:S1'].status,'verified');
  assert.equal(doc.artifacts.unit_avatar_YOUNG.modelId,'vrm-YOUNG');
  assert.equal(doc.bindings['S1:YOUNG'].nativeEntityId,'native-S1-YOUNG');
  assert.equal(doc.bindings['S2:MONITOR'].nativeEntityId,'native-S2-MONITOR');
  assert.ok(f.calls.every(call=>call.request.model==='provider/model' && call.request.effort==='high'));
  assert.equal(new Set(f.calls.map(call=>call.request.sessionId)).size,f.calls.length,'each phase starts fresh model history');
  for(const call of f.calls)assert.equal(doc.agentExecution.steps[call.task.id].sessionId,call.request.sessionId);
 }finally{f.domain.dispose();}
});

test('provider failure stops subsequent phases and resume does not regenerate completed avatars',async()=>{
 const f=fixture();try{
  f.setFailure('layout:S1');
  await assert.rejects(f.pilot.run({model:'provider/model'}),/provider offline/);
  assert.equal(f.domain.read().agentExecution.status,'failed');
  assert.equal(f.calls.some(call=>call.task.phase==='motion'),false);
  const avatarsBefore=f.calls.filter(call=>call.task.phase==='avatar').length;
  const failedSession=f.domain.read().agentExecution.steps['layout:S1'].sessionId;
  f.setFailure(null);await f.pilot.run({model:'provider/other'});
  assert.equal(f.calls.filter(call=>call.task.phase==='avatar').length,avatarsBefore);
  assert.equal(f.domain.read().agentExecution.status,'verified');
  assert.notEqual(f.domain.read().agentExecution.steps['layout:S1'].sessionId,failedSession,'resume drops the failed transcript while keeping installed assets');
 }finally{f.domain.dispose();}
});

test('source changes during an agent turn are refused before a step is marked verified',async()=>{
 const f=fixture();try{
  const changing=createProductionPilot({domain:f.domain,bus:{},buildContext:()=>({host:{sceneId:'initial'}}),readEditor:()=>f.editor,
   transport:{turn:async()=>{f.domain.write(doc=>({...doc,source:{...doc.source,snapshot:{...doc.source.snapshot,title:'changed'}}}));}}});
  await assert.rejects(changing.run({model:'model'}),/source a changé/);
  assert.equal(f.domain.read().agentExecution.status,'failed');
 }finally{f.domain.dispose();}
});

test('resume rechecks every completed scene without generating another avatar or motion',async()=>{
 const f=fixture();try{
  await f.pilot.run({model:'provider/model'});
  const before=f.calls.length;
  await f.pilot.run({model:'provider/model'});
  assert.deepEqual(f.calls.slice(before).map(c=>c.task.phase),['verify','verify']);
 }finally{f.domain.dispose();}
});

test('stop aborts the active turn even when the remote stop fails',async()=>{
 const f=fixture();try{
  let entered;const ready=new Promise(resolve=>{entered=resolve;});
  let request;
  const pilot=createProductionPilot({domain:f.domain,bus:{},buildContext:()=>({host:{sceneId:'initial'}}),readEditor:()=>f.editor,
   transport:{stop:async envelope=>{assert.equal(envelope.turnId,request.turnId);throw new Error('offline');},
    turn:async(envelope,emit,signal)=>{request=envelope;entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}}});
  const running=pilot.run({model:'provider/model'});
  const rejected=assert.rejects(running,/abort/i);
  await ready;await assert.rejects(pilot.stop(),/offline/);await rejected;
  assert.equal(f.domain.read().agentExecution.status,'stopped');
 }finally{f.domain.dispose();}
});
