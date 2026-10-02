import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAppContext} from '../src/app-context.js';
import {createDocumentStore} from '../src/document-store.js';
import {createProductionDomain} from '../src/domains/production.js';
import {compile} from '../src/production/compiler.js';

function appWithScenes(ids){
 const app=createAppContext();
 const store=createDocumentStore({owned:{scenes:ids.map(id=>({id}))}});
 app.registerStoreDomain('scenes',{documentStore:store,read:()=>store.read('scenes')});
 return {app,store};
}
async function withStorage(run){
 const previous=globalThis.localStorage,values=new Map();
 globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 try{await run(values);}finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
}
const source=()=>JSON.parse(readFileSync(new URL('./fixtures/production/narrative-v2.json',import.meta.url),'utf8'));

test('reload from the base App context restores source, plan, VRMs, bindings and pilot checkpoints',async()=>{
 await withStorage(()=>{
  const first=appWithScenes(['native-S1','native-S2']),domain=createProductionDomain(first.app);
  const s=source();domain.setSourceSnapshot(s,null,'connection-1');domain.writePlan(JSON.parse(JSON.stringify(compile(s).plan.plan)));
  domain.setArtifact('unit_avatar_YOUNG',{kind:'vrm',modelId:'vrm-existing',resourceId:'asset-existing'});
  domain.patchBindings({S1:{sourceId:'S1',nativeSceneId:'native-S1',nativeEntityId:'native-S1',nativeKind:'scene',installedInputHash:'scene-hash'},'S1:YOUNG':{sourceId:'S1:YOUNG',nativeSceneId:'native-S1',nativeEntityId:'actor-existing',nativeKind:'character',installedInputHash:'actor-hash'}});
  domain.write(doc=>({...doc,agentExecution:{status:'running',model:'provider/model',effort:'high',fingerprint:'source-hash',avatars:{YOUNG:{modelId:'vrm-existing'}},currentTask:'layout:S1',steps:{'avatar:YOUNG':{status:'verified'},'layout:S1':{status:'running'}}},executionCheckpoint:{units:[{unitId:'scene',state:'done'},{unitId:'motion',state:'waiting-provider',externalJobId:'external-existing'}],runs:[{runId:'run-1',status:'active'}]}}));
  const before=structuredClone(domain.read());domain.dispose();first.store.dispose();
  const next=appWithScenes(['native-S2','native-S1']);assert.equal(next.app.shared,undefined);
  const restored=createProductionDomain(next.app),doc=restored.read();
  assert.equal(doc.productionId,before.productionId);assert.deepEqual(doc.source,before.source);assert.deepEqual(doc.plan,before.plan);
  assert.deepEqual(doc.artifacts,before.artifacts);assert.deepEqual(doc.bindings,before.bindings);
  assert.equal(doc.agentExecution.status,'interrupted');assert.equal(doc.agentExecution.steps['layout:S1'].status,'interrupted');
  assert.equal(doc.agentExecution.steps['avatar:YOUNG'].status,'verified');assert.deepEqual(doc.agentExecution.avatars,before.agentExecution.avatars);
  assert.equal(doc.agentExecution.model,'provider/model');assert.equal(doc.agentExecution.effort,'high');
  assert.equal(doc.executionCheckpoint.units[0].state,'done');assert.equal(doc.executionCheckpoint.units[1].state,'uncertain');
  assert.equal(doc.executionCheckpoint.units[1].externalJobId,'external-existing');assert.equal(doc.executionCheckpoint.runs[0].status,'paused');
  restored.dispose();next.store.dispose();
 });
});

test('scene creation after the last production change updates the session association',async()=>{
 await withStorage(()=>{
  const first=appWithScenes(['original']),domain=createProductionDomain(first.app);
  domain.setSourceSnapshot(source());const id=domain.read().productionId;
  first.store.recordAction('scenes',()=>first.store.write('scenes',()=>[{id:'original'},{id:'new-scene'}]));
  domain.dispose();first.store.dispose();
  const next=appWithScenes(['original','new-scene']),restored=createProductionDomain(next.app);
  assert.equal(restored.read().productionId,id);assert.ok(restored.read().source.snapshot);
  restored.dispose();next.store.dispose();
 });
});

test('a different native project or corrupt cache never adopts another production',async()=>{
 await withStorage(values=>{
  const first=appWithScenes(['original']),domain=createProductionDomain(first.app);
  domain.setSourceSnapshot(source());const id=domain.read().productionId;domain.dispose();first.store.dispose();
  const other=appWithScenes(['unrelated']),unrelated=createProductionDomain(other.app);
  assert.notEqual(unrelated.read().productionId,id);assert.equal(unrelated.read().source,null);unrelated.dispose();other.store.dispose();
  values.set('cozyclay-production-session-v1','broken-json');
  const next=appWithScenes(['original']),corrupt=createProductionDomain(next.app);
  assert.equal(corrupt.read().source,null);corrupt.dispose();next.store.dispose();
 });
});

test('completed production remains completed when a portable project is reopened',async()=>{
 const {app,store}=appWithScenes(['scene']),domain=createProductionDomain(app);
 const doc={...structuredClone(domain.read()),agentExecution:{status:'verified',steps:{'verify:S1':{status:'verified'}}}};
 domain.loadPortable(doc);assert.equal(domain.read().agentExecution.status,'verified');
 domain.dispose();store.dispose();
});

test('previous pilot binding hashes migrate without losing a saved production',async()=>{
 await withStorage(values=>{
  const first=appWithScenes(['scene']),domain=createProductionDomain(first.app);
  domain.setSourceSnapshot(source());
  domain.patchBindings({actor:{sourceId:'YOUNG',nativeSceneId:'scene',nativeEntityId:'actor',nativeKind:'character',inputHash:'previous-hash'}});
  const id=domain.read().productionId;domain.dispose();first.store.dispose();
  const next=appWithScenes(['scene']),restored=createProductionDomain(next.app);
  assert.equal(restored.read().productionId,id);
  assert.equal(restored.read().bindings.actor.installedInputHash,'previous-hash');
  // Other malformed fields are still rejected instead of admitting another schema.
  restored.dispose();next.store.dispose();
  const cached=JSON.parse(values.get('cozyclay-production-session-v1'));
  delete cached.document.bindings.actor.nativeSceneId;
  values.set('cozyclay-production-session-v1',JSON.stringify(cached));
  const invalid=appWithScenes(['scene']),rejected=createProductionDomain(invalid.app);
  assert.equal(rejected.read().source,null);rejected.dispose();invalid.store.dispose();
 });
});
