import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {cameraBrowser} from './camera-browser-harness.mjs';
import {connectController,discoverEndpoint} from '../bin/live/client.mjs';
import {createStudioTools} from '../bin/agent/studio-tools.mjs';
const b=await cameraBrowser();let controller;
const until=async(expression,ms=240000)=>{const deadline=Date.now()+ms;while(!await b.evaluate(expression)){if(Date.now()>deadline)throw Error(`Timeout: ${expression}`);await new Promise(r=>setTimeout(r,250));}};
try {
  await b.seed();await until("!!document.querySelector('.live-workspace-handle')");
  controller=await connectController(discoverEndpoint(Number(process.env.COZYCLAY_LIVE_PORT||5291)));
  const workspaceHandle=await b.evaluate("document.querySelector('.live-workspace-handle').dataset.liveWorkspace");
  const request=async(name,args,timeoutMs=30000)=>{const reply=await controller.request({type:'cmd',name,args,workspaceHandle,timeoutMs},{timeoutMs});assert.equal(reply.ok,true,JSON.stringify(reply.error));return reply.value;};
  const run=async(action,args)=>{
    const {context}=await request('inspect_studio',{scope:'scene'});
    const host=Object.fromEntries(['workspaceId','documentEpoch','sceneId','sceneEpoch'].map(k=>[k,context.host[k]]));
    const admission={host,revision:context.revision.scene,commandId:randomUUID,refresh:async()=>{admission.revision=(await request('inspect_studio',{scope:'scene'})).context.revision.scene;}};
    const tools=createStudioTools({workspaceHandle,session:{admission,actionIndex:context.actionIndex},liveHub:{command:(name,payload,_workspace,options)=>request(name,payload,options?.timeoutMs??30000)}});
    const result=await tools.internal.invoke('run_action',{action,args});
    assert(result.ok,JSON.stringify(result));
    if(['character.generateVrm','character.importVrmJob'].includes(action))assert.equal(result.status,'completed','agent adapter awaits installation automatically');
    return result;
  };
  const history=await b.evaluate("(async()=>await(await fetch('/vrm-api/api/v1/jobs?limit=20')).json())()");
  const existing=history.jobs.find(job=>job.status==='completed');assert(existing,'API has a completed job for the resume/import check');
  await run('view.setMode',{mode:'scene'});
  await b.evaluate("document.querySelector('[data-vrm-generator]').scrollIntoView()");
  await b.click('[aria-label="VRM name"]');await b.send('Input.insertText',{text:'Atelier QA Hero'});
  await b.click('[aria-label="VRM description"]');await b.send('Input.insertText',{text:'Un homme anime adulte, cheveux bruns courts, yeux marron, t-shirt bleu simple et pantalon noir. Utilise les presets existants du catalogue, une tenue simple.'});
  if(process.env.QA_VRM_JOB)await run('character.importVrmJob',{jobId:process.env.QA_VRM_JOB,name:'Atelier QA Hero'});
  else await b.click('[data-vrm-generator] > button');
  await until("(async()=>{const {vrmJobsSnapshot}=await import('/src/vrm-generation.js');const job=vrmJobsSnapshot().find(j=>j.name==='Atelier QA Hero');if(job?.error)throw Error(job.error);return !!job?.installed})()");
  console.log(process.env.QA_VRM_JOB?'PASS Atelier job resumed and imported without new generation':'PASS real Atelier text-to-VRM generation followed and installed through the UI');
  const local=await b.evaluate("(async()=>{const {vrmJobsSnapshot}=await import('/src/vrm-generation.js');return vrmJobsSnapshot().find(j=>j.name==='Atelier QA Hero')})()");
  const second=await run('character.importVrmJob',{jobId:existing.id,name:'Atelier QA Second',placement:{x:-2,z:0,rot:30}});
  assert(second.undo,'import has retained undo');
  const ids=[local.characterId,second.output.characterId];
  let entities;
  const deadline=Date.now()+60000;
  for(;;){entities=(await request('inspect_studio',{scope:'entities',ids})).entities;if(entities.length===2 && entities.every(e=>e.capabilities.rigReady))break;if(Date.now()>deadline)throw Error(JSON.stringify(entities));await new Promise(r=>setTimeout(r,300));}
  for(const entity of entities){assert.equal(entity.expressionCapabilities.status,'ready');assert(entity.expressionCapabilities.available.some(row=>row.name==='happy'));}
  const smile=await run('character.set',{id:ids[0],set:{expressions:[{expression:'happy',keys:[{t:0,weight:.7},{t:2,weight:0}]}]}});
  const project=await b.evaluate('window.__cozyclayProject.export("Atelier generation QA")');
  const decoded=JSON.parse(project);assert(decoded.resources.assets.length>=1,'generated VRM is embedded');
  await run('edit.undo',{receiptId:smile.receiptId});
  await run('edit.undo',{receiptId:second.receiptId});
  const undone=await request('inspect_studio',{scope:'entities',ids:[ids[1]]});assert.equal(undone.entities.length,0,'undo removes imported avatar');
  assert.equal(await b.evaluate(`(async()=> (await window.__cozyclayProject.open(${JSON.stringify(project)})).ok)()`),true);
  await b.ready();await until(`window.__cozyclayMcpRigReady?.includes(${JSON.stringify(ids[0])}) && window.__cozyclayMcpRigReady?.includes(${JSON.stringify(ids[1])})`);
  await run('view.setMode',{mode:'scene'});await b.evaluate("document.querySelector('[data-vrm-generator]').scrollIntoView()");
  const dir='docs/qa/vrm-generation';await mkdir(dir,{recursive:true});const screenshot=await b.send('Page.captureScreenshot',{format:'png'});await writeFile(`${dir}/studio.png`,Buffer.from(screenshot.data,'base64'));
  await writeFile(`${dir}/result.json`,JSON.stringify({checks:['external job tracking','agent import of completed job','two generated VRM rigs loaded','happy expression capability','undo','project embeds avatar bytes','reopen without API model URL'],generationMode:process.env.QA_VRM_JOB?'resume previously generated job':'new UI text-to-VRM',generationJobId:local.jobId,importJobId:existing.id,characterIds:ids,assetCount:decoded.resources.assets.length},null,2));
  console.log('PASS generated VRMs: two rigged characters, facial capabilities, agent import, undo and embedded project reopen');
}finally{controller?.close();b.close();}
