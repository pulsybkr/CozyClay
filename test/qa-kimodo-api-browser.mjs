// Replays an already generated Modal artifact; this QA never launches a GPU job.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cameraBrowser } from './camera-browser-harness.mjs';
const output=process.env.QA_KIMODO_OUT || join(tmpdir(),'cozy-kimodo-modal-qa');
const encoded=readFileSync(join(output,'studio.npz')).toString('base64');
mkdirSync(output,{recursive:true});
const browser=await cameraBrowser();
const {evaluate,send}=browser;
async function until(expression) {
 const limit=Date.now()+60000;
 while(Date.now()<limit) {if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150));}
 throw new Error('VRM editor readiness deadline');
}
try {
 await until('!!window.__cozyclayProject && !!window.__cozyclay?.rigA');
 await evaluate("(async()=>window.__cozyclayProject.open(await(await fetch('/scenes/vrm-dialogue.cclayproject')).text()))()");
 await until("window.__cozyclay?.rigA?.userData.characterFormat==='vrm'");
 const result=await evaluate(`(async()=>{
  const {decodeMotionNpz}=await import('/src/ardy/npz.js');
  const {applyMotionFrame,snapshotPlaybackBones,restorePlaybackBones}=await import('/src/ardy/playback.js');
  const {loadVrm,disposeVrm,vrmRuntime,applyVrmExpressions}=await import('/src/vrm-runtime.js');
  const {characterModelUrl}=await import('/src/character-model-urls.js');
  const clip=await decodeMotionNpz(Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0)));
  const first=window.__cozyclay.rigA,second=await loadVrm(characterModelUrl('char-02-vrm'));
  const snapshot=snapshotPlaybackBones(first);
  function values(rig){return vrmRuntime(rig).bones.flatMap(b=>[...b.node.position.toArray(),...b.node.quaternion.toArray()]);}
  try {
   const names=Object.keys(vrmRuntime(first).vrm.expressionManager.expressionMap);
   const name=names.includes('happy')?'happy':names[0];
   applyVrmExpressions(first,[{expression:name,keys:[{t:0,weight:0.7}]}],0);
   const changed=[];
   for(const rig of[first,second]) {
    applyMotionFrame(rig,clip,0);const start=values(rig);
    applyMotionFrame(rig,clip,clip.frames-1);const end=values(rig);
    changed.push(end.some((v,i)=>Math.abs(v-start[i])>0.0001));
    if(!end.every(Number.isFinite))throw new Error('Invalid VRM transform');
    applyMotionFrame(rig,clip,0);const again=values(rig);
    if(!again.every((v,i)=>Math.abs(v-start[i])<1e-6))throw new Error('Non deterministic seek');
   }
   return {frames:clip.frames,fps:clip.fps,changed,facePreserved:vrmRuntime(first).vrm.expressionManager.getValue(name)===0.7};
  } finally {restorePlaybackBones(first,snapshot);applyVrmExpressions(first,[],0);disposeVrm(second);}
 })()`);
 assert.deepEqual(result.changed,[true,true]);assert.equal(result.facePreserved,true);
 assert.equal(result.frames,48);assert.equal(result.fps,24);
 await evaluate('window.__cozyclay.frameEditorCam({x:0,y:1.65,z:5.4},{x:0,y:1.2,z:0})');
 const image=await send('Page.captureScreenshot',{format:'png'});
 writeFileSync(join(output,'vrm-replay.png'),Buffer.from(image.data,'base64'));
 writeFileSync(join(output,'browser-report.json'),JSON.stringify(result,null,2));
 console.log('PASS real Modal motion on Sakura and CHAR 02: movement, finite transforms, deterministic seek, facial independence');
} finally {browser.close();}
