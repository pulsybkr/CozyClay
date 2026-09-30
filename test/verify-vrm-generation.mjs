import assert from 'node:assert/strict';
import {generateVrmAsset,validateVrmBytes,vrmJobsSnapshot} from '../src/vrm-generation.js';
import {generatedVrmAssetId,isVrmModel} from '../src/character-models.js';
import {createCharacterEntry} from '../src/scenes.js';
import {assetUsageCounts,assetGraphSignature,meshIdForBytes} from '../src/scene-assets.js';
import {createProjectDocument,readProjectDocument} from '../src/project.js';
const json=JSON.stringify({asset:{version:'2.0'},extensions:{VRMC_vrm:{humanoid:{humanBones:{hips:{node:0}}}}}});
const payload=new TextEncoder().encode(json.padEnd(Math.ceil(json.length/4)*4,' ')),bytes=new ArrayBuffer(20+payload.length),view=new DataView(bytes);
view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.byteLength,true);view.setUint32(12,payload.length,true);view.setUint32(16,0x4e4f534a,true);new Uint8Array(bytes,20).set(payload);
validateVrmBytes(bytes);assert.throws(()=>validateVrmBytes(new TextEncoder().encode('<html>not vrm</html>').buffer));
const assetId=await meshIdForBytes(bytes),modelId=`vrm-${assetId}`;
assert.equal(generatedVrmAssetId(modelId),assetId);assert(isVrmModel(modelId));
const character=createCharacterEntry({id:'generated',model:modelId,subject:'Test'},0);assert.equal(character.model,modelId);
const scenes=[{id:'s',name:'Test',objects:[],stage:{characters:[character]}}];
assert.equal(assetUsageCounts(scenes).get(assetId),1);
assert.notEqual(assetGraphSignature(scenes),assetGraphSignature([{...scenes[0],stage:{characters:[]}}]),'asset deletion sees character references');
const project=createProjectDocument({name:'VRM',scenesDocument:{version:4,activeSceneId:'s',scenes},assets:[{id:assetId,type:'model/gltf-binary',name:'Test.vrm',bytes}],motions:[]});
assert.equal(project.resources.assets.length,1,'project embeds the generated avatar');
const parsed=readProjectDocument(JSON.stringify(project));assert(parsed.ok);assert.equal(parsed.project.scenesDocument.scenes[0].stage.characters[0].model,modelId);
const fetchBefore=globalThis.fetch;let submitted=0,polled=0,stored=0;
const store=async downloaded=>{stored++;assert.deepEqual(downloaded,bytes);return{assetId,modelId};};
try {
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('text-to-vrm')) {submitted++;const body=JSON.parse(options.body);assert.deepEqual(body,{prompt:'A blue outfit',name:'Hero',gender:'female'});return Response.json({job_id:'job_test',check_interval_ms:500});}
    if(url.endsWith('/download'))return new Response(bytes);
    polled++;return Response.json({id:'job_test',status:polled===1?'processing':'completed',progress:polled===1?44:100,step:'exporting'});
  };
  const result=await generateVrmAsset({prompt:'A blue outfit',name:'Hero',gender:'female',placement:{x:2}},{store});
  assert.deepEqual(result,{assetId,modelId,jobId:'job_test'});assert.equal(submitted,1);assert.equal(stored,1);
  await generateVrmAsset({jobId:'job_test',name:'Reuse'},{store});assert.equal(submitted,1,'resume never submits another paid request');
  globalThis.fetch=async()=>Response.json({status:'failed',progress:55,error:'VRoid export failed'});
  await assert.rejects(generateVrmAsset({jobId:'job_failed',name:'Failure'},{store}),/VRoid export failed/);assert.equal(stored,2);
  const cancel=new AbortController();globalThis.fetch=async()=>{cancel.abort(new Error('tracking cancelled'));return Response.json({status:'queued',progress:0});};
  await assert.rejects(generateVrmAsset({jobId:'job_cancelled',name:'Cancelled'},{signal:cancel.signal,store}),/tracking cancelled/);
  assert.equal(stored,2);assert(vrmJobsSnapshot().find(row=>row.jobId==='job_cancelled').error.includes('job_cancelled'));
  console.log('PASS VRM generation: correlated jobs, polling, download validation, resume, cancellation, failure, persistent model and embedded project asset');
}finally{globalThis.fetch=fetchBefore;}
