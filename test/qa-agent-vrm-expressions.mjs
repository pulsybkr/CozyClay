import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cameraBrowser } from './camera-browser-harness.mjs';
import { connectController, discoverEndpoint } from '../bin/live/client.mjs';

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
  await until('!!window.__cozyclayProject && !!window.__cozyclay?.rigA');
  assert.equal(await b.evaluate("(async()=> (await window.__cozyclayProject.open(await (await fetch('/scenes/vrm-dialogue.cclayproject')).text())).ok)()"), true);
  await until("window.__cozyclay?.rigA?.userData.characterFormat==='vrm' && window.__cozyclayMcpRigReady?.includes('char-b') && !!document.querySelector('.live-workspace-handle')");
  controller = await connectController(discoverEndpoint(Number(process.env.COZYCLAY_LIVE_PORT || 5291)));
  const request = async (name, args) => {
    const reply = await controller.request({ type: 'cmd', name, args, timeoutMs: 30000 }, { timeoutMs: 30000 });
    assert.equal(reply.ok, true, JSON.stringify(reply.error));
    return reply.value;
  };
  const inspected = await request('inspect_studio', { scope: 'entities', ids: ['char-a', 'char-b'] });
  for (const entity of inspected.entities) {
    assert.equal(entity.expressionCapabilities.status, 'ready');
    assert(entity.expressionCapabilities.available.some(e => e.name === 'happy'));
    assert.equal(entity.expressionCapabilities.truncated, false);
  }
  assert.equal(inspected.entities.length, 2);
  const context = inspected.context;
  const host = Object.fromEntries(['workspaceId','documentEpoch','sceneId','sceneEpoch'].map(k => [k,context.host[k]]));
  const changed = await request('run_action', { name: 'run_action', commandId: randomUUID(), host,
    expectedRevision: context.revision.scene,
    args: { action: 'character.set', args: { id: 'char-a', set: { expressions: [{ expression: 'happy', keys: [{t:0,weight:0.7},{t:3,weight:0}] }] } } } });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  await until("(async()=>{const {vrmRuntime}=await import('/src/vrm-runtime.js');return vrmRuntime(window.__cozyclay.rigA)?.vrm.expressionManager.getValue('happy')===0.7})()");
  const doc = await request('inspect_studio', { scope:'document', ids:['char-a'] });
  assert(JSON.stringify(doc).includes('happy'));
  console.log('PASS agent discovers expressions on both VRMs and authors a visible smile through character.set');
} finally { controller?.close(); await b.close(); }
