import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeNpz } from '../tools/ardy/npz.mjs';
import { SOMA77_JOINTS } from '../tools/kimodo/soma77-to-cskel27.mjs';
import { createKimodoApiClient } from '../tools/kimodo/api-client.mjs';
import { generateOnBox } from '../tools/kimodo/generate.mjs';
import { killGroup } from '../tools/ardy/runners/proc.mjs';
import { createKimodoRunner } from '../tools/kimodo/runner.mjs';

const folder = mkdtempSync(join(tmpdir(),'cozy-api-test-'));
const rotations = new Float32Array(30*77*9), positions = new Float32Array(30*77*3);
for (let f=0;f<30;f++) for(let j=0;j<77;j++) {
 rotations.set([1,0,0,0,1,0,0,0,1],(f*77+j)*9);
 positions[(f*77+j)*3+1] = {Hips:0.95,LeftLeg:0.9,LeftShin:0.45,LeftFoot:0.05}[SOMA77_JOINTS[j]] ?? 1;
}
writeNpz(join(folder,'native.npz'), {
 global_rot_mats:{data:rotations,shape:[30,77,3,3]},
 posed_joints:{data:positions,shape:[30,77,3]}, fps:{data:new Int32Array([30]),shape:[]},
});
const bytes=readFileSync(join(folder,'native.npz'));
const metadata={joint_count:77,fps:30,units:'meters',up_axis:'+Y',ground_plane:'XZ',rest_pose:'standard_tpose',joint_names:SOMA77_JOINTS,parents:Array(77).fill(-1),frame_count:30,files:{npz:{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:'https://untrusted.invalid/npz'}},warnings:[]};
let mode='success',calls=[],keys=[],payloads=[],poll=0;
const server=createServer(async(req,res)=>{
 calls.push(req.url); assert.equal(req.headers.authorization,'Bearer test-token');
 const respond=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(req.url.endsWith('/capabilities')) return respond(200,{api_version:'2',fps:30});
 if(req.method==='POST'&&req.url.endsWith('/jobs')) {
  let body='';for await(const chunk of req)body+=chunk;
  payloads.push(JSON.parse(body));keys.push(req.headers['idempotency-key']);
  if(mode==='retry'&&keys.length===1)return respond(503,{error:{code:'BUSY'}});
  return respond(202,{job_id:'job-1',status:'queued',stage:'waiting_for_worker',poll_after_ms:250});
 }
 if(req.url.endsWith('/cancel'))return respond(200,{job_id:'job-1',status:'cancelled'});
 if(req.url.endsWith('/metadata'))return respond(200,{...metadata,files:{npz:{...metadata.files.npz,sha256:mode==='corrupt'?'0'.repeat(64):metadata.files.npz.sha256}}});
 if(req.url.endsWith('/npz')) {res.writeHead(200,{'content-type':'application/octet-stream'});return res.end(bytes);}
 poll++;
 return respond(200,{job_id:'job-1',status:mode==='waiting'?'running':mode==='failed'?'failed':'succeeded',stage:'inference',poll_after_ms:250,error:{code:'GENERATION_FAILED'}});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const saved={url:process.env.CCLAY_KIMODO_API_URL,token:process.env.CCLAY_KIMODO_API_TOKEN};
try {
 let controlMessage='';
 const child={cozyKimodoApi:true,exitCode:0,signalCode:null,stdin:{write:value=>{controlMessage=value;}}};
 killGroup(child);assert.equal(controlMessage,'cozyclay:cancel\n');
 const client=createKimodoApiClient({origin,token:'test-token',timeoutMs:5000});
 const result=await client.generate({segments:[{prompt:'A person stands. They wave.',duration:1}],seed:-1});
 assert.equal(result.loaded.frames,30);assert.equal(payloads[0].seed,4294967295);
 assert.ok(!calls.some(path=>path.includes('untrusted')));
 mode='corrupt';await assert.rejects(client.generate({segments:[{prompt:'A person stands',duration:1}]}),/SHA-256 mismatch/);
 mode='failed';await assert.rejects(client.generate({segments:[{prompt:'A person stands',duration:1}]}),/GENERATION_FAILED/);
 mode='retry';keys=[];payloads=[];
 await client.generate({segments:[{prompt:'A person stands',duration:1}]});
 assert.equal(keys[0],keys[1]);assert.deepEqual(payloads[0],payloads[1]);
 mode='waiting';calls=[];
 const abort=new AbortController();
 const waiting=client.generate({segments:[{prompt:'A person stands',duration:1}],signal:abort.signal});
 const timer=setTimeout(()=>abort.abort(),400);
 await assert.rejects(waiting);clearTimeout(timer);
 assert.ok(calls.some(path=>path.endsWith('/cancel')));
 await assert.rejects(client.generate({segments:[{prompt:'A person stands',duration:11}]}),/1–10/);
 mode='success';process.env.CCLAY_KIMODO_API_URL=origin;process.env.CCLAY_KIMODO_API_TOKEN='test-token';
 const runner=createKimodoRunner();assert.equal((await runner.probeHealth()).ok,true);assert.equal(runner.baseMotionFor('unused.npz'),null);
 const converted=await generateOnBox({segments:[{prompt:'A person stands. They wave.',duration:1}],waypoints:[{frame:0,x:2,z:3,heading:0},{frame:23,x:2,z:4,heading:0}],appFps:24,seed:42,preserve:null});
 assert.equal(converted.motion.rotMats.length,30*27*9);assert.equal(converted.raw.fps,30);
 assert.ok(converted.motion.posedJoints.every(Number.isFinite));
 assert.equal(payloads.at(-1).constraints[0].type,'root2d');
 await assert.rejects(generateOnBox({segments:[{prompt:'A person stands',duration:1}],preserve:{basePath:'unused'}}),/does not expose/);
 console.log('PASS HTTP authentication, real NPZ decoding, checksum, idempotent retry, cancellation, API runner and SOMA77 conversion');
} finally {
 for(const [name,value]of[['CCLAY_KIMODO_API_URL',saved.url],['CCLAY_KIMODO_API_TOKEN',saved.token]]) {if(value===undefined)delete process.env[name];else process.env[name]=value;}
 await new Promise(resolve=>server.close(resolve));rmSync(folder,{recursive:true,force:true});
}
