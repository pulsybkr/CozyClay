import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotsFixture,seedShot } from './shots-fixture.mjs';
import { sampleAt } from '../../src/sample-at.js';
import { mountShots } from './shots-hook.mjs';

const ok = receipt => {assert.equal(receipt.ok,true,JSON.stringify(receipt));return receipt;};
test('production cuts retain their offset into a reusable camera track', () => {
 const f=shotsFixture();
 try {
  ok(f.run('camera.create',{name:'Travelling',cameraId:'travelling',shotId:'shot-a'}));
  ok(f.run('camera.set',{cameraId:'travelling',set:{interpolation:'linear',cameraKeys:[
   {frame:0,framing:{pos:{x:0,y:1.6,z:5},yaw:0,pitch:0,fovDeg:40}},
   {frame:47,framing:{pos:{x:0,y:1.6,z:2},yaw:0,pitch:0,fovDeg:40}},
  ]}}));
  ok(f.run('shot.upsert',{shotId:'cut-b',name:'Second cut',startFrame:24,endFrameExclusive:48,cameraId:'travelling',cameraOffsetFrame:24},'agent'));
  const cut=f.shots.read().find(s=>s.id==='cut-b');
  assert.equal(cut.cameraOffsetFrame,24);
  assert.equal(cut.cameraId,'travelling');
 } finally {f.dispose();}
});
test('video export without body motion includes the complete montage unless a shot is requested',async()=>{
  const f=shotsFixture();
  try {
    ok(f.run('shot.replace',{shots:[seedShot(),{...seedShot(),id:'shot-b',startFrame:24,endFrame:47}]}));
    Object.assign(f.scope,{recRef:{current:null},motion:null,currentRecordFrameCount:()=>120,
      exportRequest:(_kind,execute)=>execute,executeExportRequest:execute=>execute({controller:new AbortController()}),runShotExport:async options=>options});
    const hook=mountShots(f.scope.appContext.forRender(f.scope));
    assert.deepEqual(await hook.exportShotVideo({download:false}),{startFrame:0,endFrame:119,download:false});
    assert.deepEqual(await hook.exportShotVideo({download:false,shotId:'shot-b'}),{startFrame:24,endFrame:47,download:false});
  } finally {f.dispose();}
});
test('named cameras: create, edit, bind, reuse and undo through the real editor command bus',()=>{
  const f=shotsFixture();
  try {
    const before=f.snapshot();
    const created=ok(f.run('camera.create',{name:'Wide',cameraId:'wide',shotId:'shot-a'},'agent'));
    assert.equal(f.shots.state().cameras.length,1);
    assert.equal(f.shots.read()[0].cameraId,'wide');
    assert.equal(f.binding.context().cameras[0].name,'Wide');
    assert.equal(f.binding.handlers.inspect_studio({scope:'cameras'}).cameras[0].id,'wide');
    const snapshot=f.snapshot();
    const edited=ok(f.run('camera.set',{cameraId:'wide',set:{name:'Travel',interpolation:'linear',cameraKeys:[
      {frame:0,framing:{pos:{x:0,y:2,z:5},yaw:0,pitch:0,fovDeg:40}},
      {frame:23,framing:{pos:{x:2,y:2,z:5},yaw:0,pitch:0,fovDeg:40}},
    ]}},'agent'));
    assert.equal(f.shots.read()[0].cameraKeys[1].framing.pos.x,2);
    const second={...seedShot(),id:'shot-b',startFrame:24,endFrame:47,cameraKeys:[]};
    ok(f.run('shot.replace',{shots:[...f.shots.read(),second]}));
    ok(f.run('camera.assign',{shotId:'shot-b',cameraId:'wide'},'agent'));
    assert.equal(f.shots.read()[1].cameraKeys[0].frame,24);
    const state={frameCount:120,subject:{x:0,z:0}};
    assert.deepEqual(sampleAt(state,f.shots.read()[0],12).camera,sampleAt(state,f.shots.read()[1],36).camera);
    ok(f.run('camera.create',{name:'Independent',cameraId:'independent',shotId:'shot-b'},'agent'));
    assert.deepEqual(f.shots.state().cameras[1].cameraKeys,f.shots.state().cameras[0].cameraKeys,'saving a linked camera creates an independent definition without resampling');
    ok(f.run('camera.set',{cameraId:'independent',set:{name:'Variant'}},'agent'));
    assert.equal(f.shots.state().cameras[0].name,'Travel');
    ok(f.run('camera.assign',{shotId:'shot-b',cameraId:'wide'},'agent'));
    ok(f.run('camera.remove',{cameraId:'independent'},'agent'));
    const invalid=f.run('camera.set',{cameraId:'wide',set:{cameraKeys:[{frame:0,framing:{pos:{x:0,y:2,z:5},yaw:0,pitch:0,fovDeg:40}},
      {frame:0,framing:{pos:{x:1,y:2,z:5},yaw:0,pitch:0,fovDeg:40}}]}},'agent');
    assert.equal(invalid.ok,false);assert.equal(invalid.mutated,false);
    ok(f.run('camera.remove',{cameraId:'wide'},'agent'));
    assert.equal(f.shots.state().cameras.length,0);
    assert(f.shots.read().every(shot=>!shot.cameraId && shot.cameraKeys.length));
    // Isolate history assertions from the additional reuse/removal edits.
    f.shots.load(snapshot.shot);
    const rename=ok(f.run('camera.set',{cameraId:'wide',set:{name:'Rename'}},'agent'));
    assert.equal(ok(f.run('edit.undo',{receiptId:rename.receiptId},'agent')).status,'undone');
    assert.equal(f.shots.state().cameras[0].name,'Wide');
    f.shots.load(before.shot);
    assert.equal(f.shots.state().cameras.length,0);
    assert(created.undo && edited.undo);
  } finally {f.dispose();}
});

test('named cameras: legacy framing edits update the shared definition and keep one undo entry',()=>{
  const f=shotsFixture();
  try {
    ok(f.run('camera.create',{name:'Hero',cameraId:'hero',shotId:'shot-a'},'agent'));
    const before=f.snapshot();
    const receipt=ok(f.run('shot.frame',{subjectIds:['actor-a'],shotId:'shot-a',keyAtFrame:12,
      framing:{exact:{position:{x:1,y:2,z:6},lookAt:{x:0,y:1,z:0},focalMm:35}}},'agent'));
    assert(f.shots.state().cameras[0].cameraKeys.some(key=>key.frame===12));
    ok(f.run('edit.undo',{receiptId:receipt.receiptId},'agent'));
    assert.deepEqual(f.snapshot(),before);
    const revision=f.binding.refresh().revision;
    ok(f.run('camera.set',{cameraId:'hero',set:{name:'Changed'}},'agent'));
    const stale=f.run('camera.assign',{shotId:'shot-a',cameraId:null},'agent',{expectedRevision:revision});
    assert.equal(stale.code,'STALE_SCENE');
  } finally {f.dispose();}
});
