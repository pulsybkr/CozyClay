// Real VRM geometry, a synthetic bad pose and an already generated Modal take.
// No paid generation is launched by this regression.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cameraBrowser } from './camera-browser-harness.mjs';

const input = process.env.QA_KIMODO_NPZ || join(tmpdir(),'cozy-kimodo-modal-qa','studio.npz');
const encoded = readFileSync(input).toString('base64');
const out = process.env.QA_VRM_PHYSICS_OUT || join(tmpdir(),'cozy-vrm-physics-qa');
mkdirSync(out,{recursive:true});
const b = await cameraBrowser();
async function until(expression) {
  const deadline=Date.now()+60000;
  while(!await b.evaluate(expression)) {
    if(Date.now()>deadline) throw new Error('VRM readiness deadline');
    await new Promise(resolve=>setTimeout(resolve,150));
  }
}
try {
  await until('!!window.__cozyclayProject && !!window.__cozyclay?.rigA');
  await b.evaluate("(async()=>window.__cozyclayProject.open(await(await fetch('/scenes/vrm-dialogue.cclayproject')).text()))()");
  await until("window.__cozyclay?.rigA?.userData.characterFormat==='vrm'");
  const result=await b.evaluate(`(async()=>{
    const THREE=await import('/node_modules/.vite/deps/three.js');
    const {clone}=await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');
    const runtime=await import('/src/vrm-runtime.js');
    const {characterModelUrl}=await import('/src/character-model-urls.js');
    const {decodeMotionNpz}=await import('/src/ardy/npz.js');
    const {applyMotionFrame,snapshotPlaybackBones,restorePlaybackBones}=await import('/src/ardy/playback.js');
    const ik=await import('/src/ardy/ik.js');
    const physics=await import('/src/ardy/fix-collisions.js');
    const {verifyInstalledTake}=await import('/src/studio-agent-motion.js');
    const clip=await decodeMotionNpz(Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0)));
    const reports=[];
    for(const model of ['sakura-vrm','char-02-vrm']) {
      const rig=await runtime.loadVrm(characterModelUrl(model));
      runtime.setVrmStandingPose(rig);
      const resolved=ik.resolveIkRig(rig);
      if(!resolved || !physics.supportsCollisionCleanup(rig)) throw new Error(model+' unsupported');
      const state={...ik.createIkState(),...resolved};
      const torso=ik.findBone(rig,'mixamorigSpine1').getWorldPosition(new THREE.Vector3());
      ik.solveIk(resolved.chains.get('leftHand'),torso);
      runtime.syncVrm(rig);
      const relevant=()=>physics.detectPenetrations(physics.buildCollisionCapsules(rig)).filter(p=>!physics.isHingeFold(p) && [p.a.def.id,p.b.def.id].some(x=>/torso|chest|head/.test(x)));
      const before=relevant();
      if(!before.length) throw new Error('Fixture must penetrate: '+model);
      const fixed=physics.fixCollisions(rig,resolved.chains,{ikState:state,fkJoints:resolved.fkJoints,onlyChains:new Set(['leftHand','rightHand'])});
      runtime.syncVrm(rig);
      const after=relevant();
      const beforeDepth=Math.max(...before.map(p=>p.depth)),afterDepth=Math.max(0,...after.map(p=>p.depth));
      if(!(afterDepth<beforeDepth)) throw new Error('Collision was not reduced: '+model+' '+beforeDepth+' -> '+afterDepth);
      const rangeState={...ik.createIkState(),...resolved};
      const baseFrame=f=>{
        runtime.setVrmStandingPose(rig);
        const target=ik.findBone(rig,'mixamorigSpine1').getWorldPosition(new THREE.Vector3());
        target.y+=Math.sin(f/5)*.015;
        ik.solveIk(resolved.chains.get('leftHand'),target);
        runtime.syncVrm(rig);
      };
      const posed=f=>{baseFrame(f);ik.ikEvaluate(resolved.chains,rangeState,f,resolved.fkJoints,6);};
      const ranged=physics.fixCollisionsRange({rig,...resolved,ikState:rangeState,startFrame:0,endFrame:11,
        onlyChains:new Set(['leftHand','rightHand']),applyFrame:posed});
      if(!ranged.length) throw new Error('No collision correction keys');
      posed(7);const seek=snapshotPlaybackBones(rig).map(row=>row.slice(1));
      posed(2);posed(7);
      if(JSON.stringify(seek)!==JSON.stringify(snapshotPlaybackBones(rig).map(row=>row.slice(1)))) throw new Error('Correction depends on seek order');
      const rangeDepth=Math.max(0,...relevant().map(p=>p.depth));
      if(!(rangeDepth<beforeDepth)) throw new Error('Baked correction did not replay');
      applyMotionFrame(rig,clip,12);
      const privateRig=clone(rig),original=[],copies=[];
      rig.traverse(n=>original.push(n));privateRig.traverse(n=>copies.push(n));
      privateRig.userData.poseBind=new Map(original.flatMap((n,i)=>{const bind=rig.userData.poseBind.get(n);return bind?[[copies[i],structuredClone(bind)]]:[]}));
      runtime.attachVrmEvaluationClone(rig,privateRig);
      applyMotionFrame(privateRig,clip,12);
      const sourcePairs=runtime.vrmRuntime(rig).syncPairs,copyPairs=runtime.vrmRuntime(privateRig).syncPairs;
      const cloneError=Math.max(...sourcePairs.map((p,i)=>p.raw.getWorldPosition(new THREE.Vector3()).distanceTo(copyPairs[i].raw.getWorldPosition(new THREE.Vector3()))));
      if(cloneError>1e-6) throw new Error('Cloned skin diverges: '+cloneError);
      runtime.releaseVrmEvaluationClone(privateRig);
      runtime.applyVrmExpressions(rig,[{expression:'happy',keys:[{t:0,weight:.7}]}],0);
      const held=snapshotPlaybackBones(rig),values=held.map(row=>row.slice(1));
      const verification=await verifyInstalledTake({target:{character:{id:'qa',x:0,y:0,z:0,scale:1,rot:0},rig,motion:clip,ikState:ik.createIkState()},
        environment:{host:{},physicsRevision:0,floor:{model:'flat',y:0},objects:[],cast:[],frameCount:clip.frames},yieldTask:async()=>{},verificationMs:60000});
      if(JSON.stringify(values)!==JSON.stringify(snapshotPlaybackBones(rig).map(row=>row.slice(1)))) throw new Error('Verification changed live pose');
      if(runtime.vrmRuntime(rig).vrm.expressionManager.getValue('happy')!==.7) throw new Error('Verification changed face');
      reports.push({model,beforeDepth,afterDepth,changed:fixed.changed,correctedFrames:ranged.length,rangeDepth,unresolved:ranged.unresolved.length,cloneError,evaluatedFrames:verification.evaluatedFrames,status:verification.status,surfaceMeasured:verification.surfaceMeasured,limitations:verification.limitations});
      restorePlaybackBones(rig,held);
      runtime.disposeVrm(rig);
    }
    return reports;
  })()`);
  for(const report of result) {
    assert(report.changed);
    assert(report.afterDepth<report.beforeDepth);
    assert.equal(report.evaluatedFrames,48);
    assert.equal(report.surfaceMeasured,true);
  }
  writeFileSync(join(out,'report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  console.log('PASS VRM collision correction, isolated verification, exact clone skin and facial independence on both avatars');
} finally { await b.close(); }
