// Exercise the real editor installation/history path with a cached GPU artifact.
// The isolated QA page intercepts generation; no new paid request is sent.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cameraBrowser } from './camera-browser-harness.mjs';
import { connectController, discoverEndpoint } from '../bin/live/client.mjs';

const encoded = readFileSync(process.env.QA_KIMODO_NPZ || join(tmpdir(), 'cozy-kimodo-modal-qa', 'studio.npz')).toString('base64');
const b = await cameraBrowser();
let controller;
async function until(expression) {
  const deadline = Date.now() + 60000;
  while (!await b.evaluate(expression)) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${expression}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}
try {
  // Readiness belongs to the same deterministic fixture as generation, so a
  // real bridge health timeout cannot influence this installation regression.
  await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const fetchReal=window.fetch.bind(window);
    window.fetch=(url,options)=>url==='/ardy/health'
      ? Promise.resolve(new Response(JSON.stringify({ok:true,backend:'http_kimodo',host_configured:true,device:'remote'}),{headers:{'Content-Type':'application/json'}}))
      : fetchReal(url,options);
  })()`});
  await b.navigate(new URL('/app/',b.base));
  await until('!!window.__cozyclayProject && !!window.__cozyclay?.rigA');
  await b.evaluate("(async()=>window.__cozyclayProject.open(await(await fetch('/scenes/vrm-dialogue.cclayproject')).text()))()");
  await until("window.__cozyclay?.rigA?.userData.characterFormat==='vrm' && window.__cozyclayMcpRigReady?.includes('char-b') && !!document.querySelector('.live-workspace-handle')");
  await b.evaluate(`(()=>{
    const fetchReal=window.fetch.bind(window);
    const bytes=Uint8Array.from(atob(${JSON.stringify(encoded)}),c=>c.charCodeAt(0));
    const artifact=URL.createObjectURL(new Blob([bytes]));
    window.__qaGenerationRequests=[];
    window.fetch=(url,options)=>{
      if(url==='/ardy/generate') {
        window.__qaGenerationRequests.push(JSON.parse(options.body));
        return Promise.resolve(new Response(JSON.stringify({event:'done',motionUrl:artifact})+'\\n',
          {headers:{'Content-Type':'application/x-ndjson'}}));
      }
      return fetchReal(url,options);
    };
  })()`);
  controller = await connectController(discoverEndpoint(Number(process.env.COZYCLAY_LIVE_PORT || 5291)));
  const request = async (name,args) => {
    const reply=await controller.request({type:'cmd',name,args,timeoutMs:60000},{timeoutMs:60000});
    assert.equal(reply.ok,true,JSON.stringify(reply.error));
    return reply.value;
  };
  const action = async (action,args) => {
    const {context}=await request('inspect_studio',{scope:'scene'});
    const host=Object.fromEntries(['workspaceId','documentEpoch','sceneId','sceneEpoch'].map(k=>[k,context.host[k]]));
    const receipt=await request('run_action',{name:'run_action',commandId:randomUUID(),host,
      expectedRevision:context.revision.scene,args:{action,args}});
    assert.equal(receipt.ok,true,JSON.stringify(receipt));
    return receipt;
  };
  // Removing a loaded character leaves a null rig slot in the renderer registry.
  // It must not break the snapshot at the next motion.generate boundary.
  await action('character.remove',{characterId:'char-b'});
  await until("!window.__cozyclayMcpRigReady?.includes('char-b')");
  const started=await action('motion.generate',{characterId:'char-a',durationSeconds:2,seed:42,
    blocks:[{id:'qa',text:'Walk then wave',startFrame:0,endFrame:48}]});
  const completed=started.status==='started' ? await action('job.await',{jobId:started.jobId,timeoutMs:60000}) : started;
  assert.equal(completed.status,'completed',JSON.stringify(completed));
  const report=completed.output?.collisionReview;
  assert.equal(report?.skipped,false,JSON.stringify(completed));
  assert.equal(report.scope,'self-collision-arms');
  assert.equal(report.evaluatedFrames,48);
  await until('window.__cozyclay.motion?.frames===48');
  assert.equal(await b.evaluate('window.__qaGenerationRequests.length'),1);
  const exported=await b.evaluate("window.__cozyclayProject.export('Collision QA')");
  assert(JSON.stringify(exported).includes('sakura-vrm'));
  const project=typeof exported==='string' ? JSON.parse(exported) : exported;
  const character=project.scenes.scenes.flatMap(scene=>scene.stage.characters).find(row=>row.id==='char-a');
  assert.equal(character.motionRef.correctionKeys.length,report.correctedFrames,'Baked correction keys must survive project serialization');
  const manual=await action('motion.fixCollisions',{characterId:'char-a',scope:'clip'});
  assert.match(manual.summary,/Reviewed 48 frames/);
  await action('edit.undo',{receiptId:manual.receiptId});
  await action('edit.undo',{receiptId:completed.receiptId});
  await until('!window.__cozyclay.motion');
  assert.equal(await b.evaluate(`(async()=> (await window.__cozyclayProject.open(${JSON.stringify(exported)})).ok)()`),true);
  await until('window.__cozyclay.motion?.frames===48');
  const reopened=JSON.parse(await b.evaluate("window.__cozyclayProject.export('Reopened Collision QA')"));
  const restored=reopened.scenes.scenes.flatMap(scene=>scene.stage.characters).find(row=>row.id==='char-a');
  assert.equal(restored.motionRef.correctionKeys.length,report.correctedFrames,'Opening a project must restore the authoritative correction layer');
  assert.equal(await b.evaluate('window.__qaGenerationRequests.length'),1);
  console.log(JSON.stringify({generationReview:report,manualReview:manual.summary}));
  console.log('PASS VRM generation auto-review, agent receipts, existing-take review, single-entry undo and project roundtrip without a new GPU call');
} finally { controller?.close(); await b.close(); }
