import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createAgentHandler} from '../bin/agent/agent-routes.mjs';
import {readLiveEndpoint} from '../bin/live-endpoint.mjs';
import {spawnOwned,terminateOwned} from '../tools/process-supervisor.mjs';

async function withOccupiedPort(run){
 const blocker=createServer();
 await new Promise((resolve,reject)=>{blocker.once('error',reject);blocker.listen(0,'127.0.0.1',resolve);});
 const scratch=mkdtempSync(join(tmpdir(),'cozy-agent-live-start-'));
 const previous=process.env.XDG_CONFIG_HOME;process.env.XDG_CONFIG_HOME=scratch;
 try{await run(blocker.address().port,blocker);}
 finally{
  if(previous===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=previous;
  await new Promise(resolve=>blocker.close(resolve));
  assert.ok(resolve(scratch).startsWith(resolve(tmpdir())+sep));
  rmSync(scratch,{recursive:true,force:true});
 }
}

test('occupied default live port gets a separate owned hub, without adopting or stopping its owner',async()=>{
 await withOccupiedPort(async(port,blocker)=>{
  const handler=createAgentHandler({livePort:port,allowLivePortFallback:true,sessionStore:{read:()=>null}});
  let selected;
  try{
   selected=(await handler.liveReady()).port;
   assert.ok(selected>0);assert.notEqual(selected,port);
   const endpoint=readLiveEndpoint(selected);
   assert.equal(endpoint.pid,process.pid);assert.equal(endpoint.port,selected);
   assert.equal(blocker.listening,true);
  }finally{await handler.close();}
  assert.equal(readLiveEndpoint(selected),null);
  assert.equal(blocker.listening,true);
 });
});

test('explicit occupied live port produces an actionable startup failure',async()=>{
 await withOccupiedPort(async(port,blocker)=>{
  const handler=createAgentHandler({livePort:port,sessionStore:{read:()=>null}});
  try{
   await assert.rejects(handler.liveReady(),error=>error.code==='EADDRINUSE' && error.message.includes('COZYCLAY_LIVE_PORT'));
   assert.equal(blocker.listening,true);
  }finally{await handler.close();}
 });
});

test('full dev server sends its actual live port to Vite before the editor loads',async()=>{
 await withOccupiedPort(async()=>{
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawnOwned(process.execPath,['tools/dev-full.mjs','--host','127.0.0.1','--port',String(port)],{
   env:{...process.env,COZYCLAY_LIVE_PORT:'0',COZYCLAY_OAUTH_PORT:'',CCLAY_KIMODO_HOST:'',CCLAY_KIMODO_API_URL:''},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>{output+=String(chunk);});child.stderr.on('data',chunk=>{output+=String(chunk);});
  try{
   const deadline=Date.now()+30000;let module;
   while(Date.now()<deadline){
    assert.equal(child.exitCode,null,output.slice(-1500));
    try{
     const response=await fetch(`http://127.0.0.1:${port}/src/live-control.js`,{signal:AbortSignal.timeout(2000)});
     if(response.ok){module=await response.text();break;}
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   assert.ok(module,'Vite must serve the live editor module');
   const actual=Number(output.match(/live editor listening on owned port (\d+)/)?.[1]);
   assert.ok(actual>0);assert.match(module,new RegExp('"VITE_COZYCLAY_LIVE_PORT"\\s*:\\s*"'+actual+'"'));
   assert.equal(readLiveEndpoint(actual)?.pid,child.pid);
  }finally{await terminateOwned(child);}
 });
});
