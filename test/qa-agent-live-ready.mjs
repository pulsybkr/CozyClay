import assert from 'node:assert/strict';
import { cameraBrowser } from './camera-browser-harness.mjs';
import { connectController, discoverEndpoint } from '../bin/live/client.mjs';

const browser = await cameraBrowser();
let controller;
try {
  const deadline = Date.now() + 45000;
  while (!await browser.evaluate("!!document.querySelector('.live-workspace-handle')")) {
    if (Date.now() > deadline) throw new Error('The editor did not connect to its live service');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const endpoint = discoverEndpoint(Number(process.env.COZYCLAY_LIVE_PORT || 5291));
  controller = await connectController(endpoint);
  const reply = await controller.request({ type: 'cmd', name: 'inspect_studio', args: { scope: 'scene' }, timeoutMs: 30000 }, { timeoutMs: 30000 });
  assert.equal(reply.ok, true, JSON.stringify(reply.error));
  assert(reply.value.context.host.workspaceHandle);
  assert(reply.value.context.scene.characterCount > 0);
  console.log('PASS live editor connected and agent scene inspection succeeds');
} finally {
  controller?.close();
  await browser.close();
}
