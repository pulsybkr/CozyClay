import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSnapshot } from '../src/production/source-contract.js';
import { compile } from '../src/production/compiler.js';
import { installShots } from '../src/production/installers/index.js';
import { produceMotionClip } from '../src/production/clip-producer.js';
import { resolveSceneCamera, normalizeSceneCameras } from '../src/scene-cameras.js';
import { fetchFullSnapshotProgressive } from '../src/production/source-client.js';
import { computeCanonicalHash, SOURCE_SECTIONS } from '../src/production/source-contract.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/production/narrative-v2.json', import.meta.url), 'utf8'));

test('v2 compiles a multi-set story and retains coordinated action directives', async () => {
 const source = fixture(), original = structuredClone(source);
 assert.deepEqual(validateSnapshot(source), {valid:true,errors:[]});
 const {plan, errors} = compile(source);
 assert.ok(plan, JSON.stringify(errors));
 assert.deepEqual(source, original);
 assert.equal(plan.plan.frameCount, 96);
 assert.equal(plan.plan.sequence[2].globalStartFrame, 48);
 const unit = plan.plan.units.find(u=>u.id==='unit_motion_A1');
 assert.equal(unit.payload.motionKind, 'directive');
 assert.deepEqual(unit.payload.trajectory, source.actions[0].trajectory);
 assert.deepEqual(unit.payload.effects, source.actions[0].effects);
 assert.deepEqual(unit.payload.participantIds, ['MOTHER']);
 const artifact = await produceMotionClip(unit);
 assert.equal(artifact.plannedOnly,true);
 assert.equal(artifact.clip.actionType,'directive');
 assert.equal(artifact.clip.metadata.eventId,'BREAK');
 assert.deepEqual(artifact.clip.metadata.trajectory,source.actions[0].trajectory);
 const changed = fixture(); changed.actions[0].effects[0].condition='cracked';
 changed.scenes[0].exitState[2].condition='cracked';changed.scenes[1].entryState[1].condition='cracked';changed.scenes[1].exitState[1].condition='cracked';
 assert.notEqual(compile(changed).plan.plan.units.find(u=>u.id===unit.id).inputHash, unit.inputHash);
});

test('unkeyed facial directives preserve timing and intent as planned motion', async () => {
 for (const keys of [undefined, null, []]) {
  const source = fixture();
  const expression = {id:'FACE',kind:'expression',sceneId:'S1',characterId:'YOUNG',
   startSeconds:0.5,endSeconds:1.5,description:'Raise the eyebrows and tighten the lips.',intent:'shock',keys};
  source.actions.push(expression);
  const {plan,errors} = compile(source);
  assert.ok(plan, JSON.stringify(errors));
  const unit = plan.plan.units.find(u=>u.id==='unit_motion_FACE');
  assert.ok(unit);
  assert.equal(unit.payload.kind,'expression');
  assert.equal(unit.payload.startFrame,12);
  assert.equal(unit.payload.endFrameExclusive,36);
  assert.equal(unit.payload.motionKind,'directive');
  assert.equal(unit.payload.description,expression.description);
  assert.equal(plan.plan.units.some(u=>u.id==='unit_expression_FACE'),false);
  const result = await produceMotionClip(unit);
  assert.equal(result.plannedOnly,true);
  assert.equal(result.clip.metadata.intent,'shock');
  assert.equal(result.clip.metadata.description,expression.description);
 }
});

test('keyed facial expressions still compile as native expression tracks', () => {
 const source = fixture();
 const expression = {id:'FACE',kind:'expression',sceneId:'S1',characterId:'YOUNG',
  startSeconds:0.5,endSeconds:1.5,description:'Raise the eyebrows.',intent:'shock',keys:[{frame:12,value:0.5}]};
 source.actions.push(expression);
 const {plan,errors} = compile(source);
 assert.ok(plan, JSON.stringify(errors));
 assert.deepEqual(plan.plan.units.find(u=>u.id==='unit_expression_FACE').payload,expression);
 assert.equal(plan.plan.units.some(u=>u.id==='unit_motion_FACE'),false);
});

test('shared cameras install once and cuts retain their camera offsets and movement', async () => {
 const source=fixture(), {plan}=compile(source), calls=[];
 const units=plan.plan.units.filter(u=>u.kind==='shot' && u.payload.sceneId==='S1');
 const bus={run:async(command,args)=>{calls.push({command,args});return {ok:true,affectedIds:command==='camera.create'?[args.cameraId]:[]};}};
 await installShots(units,{bus,bindings:{S1:{nativeEntityId:'native-scene'}}});
 assert.equal(calls.filter(c=>c.command==='camera.create').length,1);
 const shots=calls.filter(c=>c.command==='shot.upsert').map(c=>c.args);
 assert.equal(shots[1].cameraOffsetFrame,24);
 const cameraSet=calls.find(c=>c.command==='camera.set').args.set;
 assert.equal(cameraSet.interpolation,'linear');
 assert.deepEqual(cameraSet.cameraKeys,source.scenes[0].cameras[0].cameraKeys);
 const resolved=resolveSceneCamera({...shots[1],id:shots[1].shotId,endFrame:shots[1].endFrameExclusive-1},normalizeSceneCameras(source.scenes[0].cameras));
 assert.ok(resolved.cameraKeys[0].framing.pos.z<4,'second cut starts within the camera movement');
});

test('v2 rejects stale continuity, missing cameras, incomplete cuts and invalid participants', () => {
 for(const [mutate,code] of [
  [s=>{s.scenes[1].entryState[1].condition='intact';},'CONTINUITY_BREAK'],
  [s=>{s.shots[1].cameraId='missing';},'SOURCE_REFERENCE_MISSING'],
  [s=>{s.shots[1].endSeconds=1.5;},'INCOMPLETE_SHOTS'],
  [s=>{s.actions[0].participantIds=['GHOST'];},'INVALID_PARTICIPANTS'],
  [s=>{s.scenes[0].exitState[2].condition='intact';},'UNEXPLAINED_STATE'],
  [s=>{s.shots[1].cameraOffsetFrame=30;},'INVALID_KEYS'],
  [s=>{s.scenes[1].globalStartSeconds=2.25;},'SCENE_GAP']
  ,[s=>{s.actions[1].eventId='ANOTHER';},'INCOMPLETE_INTERACTION']
  ,[s=>{s.actions[0].trajectory[1].timeSeconds=3;},'INVALID_TRAJECTORY']
 ]) {
  const source=fixture();mutate(source);
  const validation=validateSnapshot(source);
  assert.ok(validation.errors.some(e=>e.code===code),JSON.stringify(validation.errors));
  assert.equal(compile(source).plan,null);
 }
});

test('paginated v2 fetch retains named cameras and refuses mixed schema pages', async () => {
 const snapshot=fixture();
 const sections=await Promise.all(SOURCE_SECTIONS.map(async name=>({name,count:snapshot[name].length,ids:snapshot[name].map(i=>i.id),hash:await computeCanonicalHash(snapshot[name])})));
 const manifest={schemaVersion:snapshot.schemaVersion,projectId:snapshot.projectId,revision:snapshot.revision,title:snapshot.title,sourceMode:snapshot.sourceMode,project:snapshot.project,sections,resources:[]};
 const old=globalThis.fetch;
 let mixed=false;
 globalThis.fetch=async url=>{
  const name=SOURCE_SECTIONS.find(name=>url.includes('/sections/'+name));
  const data=name ? {schemaVersion:mixed?'cozy-story-v1':'cozy-story-v2',projectId:snapshot.projectId,revision:snapshot.revision,section:name,items:snapshot[name],total:snapshot[name].length,nextCursor:null} : manifest;
  return new Response(JSON.stringify(data),{status:200});
 };
 try {
  const fetched=await fetchFullSnapshotProgressive('connection','narrative');
  assert.equal(fetched.snapshot.schemaVersion,'cozy-story-v2');
  assert.deepEqual(fetched.snapshot.scenes[0].cameras,snapshot.scenes[0].cameras);
  mixed=true;
  await assert.rejects(()=>fetchFullSnapshotProgressive('connection','narrative'),error=>error.code==='SCHEMA_MISMATCH');
 } finally {globalThis.fetch=old;}
});
