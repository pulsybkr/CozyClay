import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cameraBrowser } from "./camera-browser-harness.mjs";

const browser = await cameraBrowser();
const { evaluate, send } = browser;
const output = process.env.QA_VRM_OUT || join(tmpdir(), "cozyclay-vrm-qa");
mkdirSync(output, { recursive: true });
const until = async expression => {
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		if (await evaluate(expression)) return;
		await new Promise(resolve => setTimeout(resolve, 150));
	}
	throw new Error(`Timed out: ${expression}`);
};
try {
	await until("!!window.__cozyclayProject && !!window.__cozyclay?.rigA");
	assert.equal(await evaluate(`(async () => {
		const text = await (await fetch('/scenes/vrm-dialogue.cclayproject')).text();
		return (await window.__cozyclayProject.open(text)).ok;
	})()`), true);
	await until("window.__cozyclay?.rigA?.userData.characterFormat === 'vrm' && window.__cozyclayMcpRigReady?.includes('char-b')");
	const initial = await evaluate(`(async () => {
		const {vrmRuntime} = await import('/src/vrm-runtime.js');
		const rig = window.__cozyclay.rigA;
		const runtime = vrmRuntime(rig);
		let meshes = 0, textures = 0;
		rig.traverse(node => { if(node.isMesh) { meshes++; for(const m of Array.isArray(node.material)?node.material:[node.material]) if(m.map) textures++; }});
		return {meshes,textures,hips:!!runtime?.hips,scale:rig.scale.x,models:JSON.parse(await window.__cozyclayProject.export()).scenes.scenes[0].stage.characters.map(c=>c.model)};
	})()`);
	assert.ok(initial.meshes > 0 && initial.textures > 0 && initial.hips);
	assert.equal(initial.scale, 1);
	assert.deepEqual(initial.models, ["sakura-vrm", "char-02-vrm"]);
	console.log("PASS two supplied VRM avatars load with original textures and metre scale");
	await evaluate("window.__cozyclay.frameEditorCam({x:0,y:1.65,z:5.4},{x:0,y:1.2,z:0})");
	await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	const screen = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(output, "scene-vrm.png"), Buffer.from(screen.data, "base64"));
	const saved = await evaluate("window.__cozyclayProject.export('VRM QA')");
	await evaluate(`window.__cozyclayProject.open(${JSON.stringify(saved)})`);
	await until("window.__cozyclay?.rigA?.userData.characterFormat === 'vrm' && window.__cozyclayMcpRigReady?.includes('char-b')");
	assert.deepEqual(await evaluate("(async () => JSON.parse(await window.__cozyclayProject.export()).scenes.scenes[0].stage.characters.map(c=>c.model))()"), initial.models);
	console.log("PASS save/reopen preserves both avatar identities");
	await browser.click('[data-node-id="characterA"] .hierarchy-row');
	await until("!!document.querySelector('.subject-model-field select')");

	await until("document.querySelector('.facial-editor select')?.options.length > 0");
	const face = await evaluate(`(async () => {
	 const {vrmRuntime,supportedVrmExpressions} = await import('/src/vrm-runtime.js');
	 const rig=window.__cozyclay.rigA, manager=vrmRuntime(rig).vrm.expressionManager;
	 const names=supportedVrmExpressions(rig).map(e=>e.name);
	 const name=names.includes('happy')?'happy':names[0];
	 window.__qaFacialName=name;
	 const receipt=window.__cozyclay.setFacialTracks('char-a',[{expression:name,keys:[{t:0,weight:0},{t:2,weight:1},{t:4,weight:0}]}]);
	 return {names,ok:receipt.ok};
	})()`);
	assert.equal(face.ok,true);
	await evaluate('window.__cozyclay.scrub(24)');
	await until("window.__cozyclay.tlFrame === 24");
	await until("(async()=>{const {vrmRuntime}=await import('/src/vrm-runtime.js'); return vrmRuntime(window.__cozyclay.rigA).vrm.expressionManager.getValue(window.__qaFacialName)===0.5})()");
	const exported = await evaluate(`window.__cozyclay.facialAtExportFrame(48)`);
	assert.equal(Object.fromEntries(exported['char-a'])[await evaluate('window.__qaFacialName')],1);
	assert.ok(exported['char-b'].every(([,weight])=>weight===0),'second avatar unaffected');
	assert.equal(await evaluate("(async()=>{const {vrmRuntime}=await import('/src/vrm-runtime.js'); return vrmRuntime(window.__cozyclay.rigA).vrm.expressionManager.getValue(window.__qaFacialName)})()"),0.5,'export restores editor face');
	assert.equal(await evaluate("window.__cozyclay.setFacialTracks('char-a',[{expression:'invalid-expression',keys:[{t:0,weight:1}]}]).ok"),false);
	await send("Input.dispatchKeyEvent",{type:"keyDown",key:"z",code:"KeyZ",modifiers:2,windowsVirtualKeyCode:90});
	await send("Input.dispatchKeyEvent",{type:"keyUp",key:"z",code:"KeyZ",modifiers:2,windowsVirtualKeyCode:90});
	await until("(async()=>{const {vrmRuntime}=await import('/src/vrm-runtime.js');return vrmRuntime(window.__cozyclay.rigA).vrm.expressionManager.getValue(window.__qaFacialName)===0})()");
	console.log('PASS facial command, interpolation, export/restoration, independence, invalid avatar name and undo');
	await browser.click('.facial-editor button');
	await until("(async()=> JSON.parse(await window.__cozyclayProject.export()).scenes.scenes[0].stage.characters[0].expressions?.length===1)()");
	const facialSave=await evaluate('window.__cozyclayProject.export()');
	await evaluate(`window.__cozyclayProject.open(${JSON.stringify(facialSave)})`);
	await until("window.__cozyclay?.rigA?.userData.characterFormat==='vrm' && window.__cozyclayMcpRigReady?.includes('char-b')");
	assert.ok(JSON.parse(await evaluate('window.__cozyclayProject.export()')).scenes.scenes[0].stage.characters[0].expressions.length);
	await browser.click('[data-node-id="characterA"] .hierarchy-row');
	await until("document.querySelector('.facial-editor select')?.options.length > 0");
	const screenshot=await send('Page.captureScreenshot',{format:'png'});
	writeFileSync(join(output,'expressions-vrm.png'),Buffer.from(screenshot.data,'base64'));
	console.log('PASS facial UI key authoring and save/reopen');
	await evaluate(`(() => {
	 const field=document.querySelector('.facial-editor textarea');
	 const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
	 setter.call(field,'Sourire de 1 ? 3 secondes'); field.dispatchEvent(new Event('input',{bubbles:true}));
	})()`);
	await until("!document.querySelector('.facial-editor > button:last-of-type').disabled");
	await browser.click('.facial-editor > button:last-of-type');
	await until("!!document.querySelector('.studio-agent-inspector textarea')?.value.includes('Expressions disponibles')");
	assert.ok(await evaluate("document.querySelector('.studio-agent-inspector textarea').value.includes('char-a')"));
	console.log('PASS facial intent prepares the existing LLM Agent with actual avatar capabilities');
	await browser.click('.studio-agent-inspector .inspector-agent-switch');

	await evaluate(`(() => {
		window.__qaPreviousVrmRig = window.__cozyclay.rigA;
		const select = document.querySelector('.subject-model-field select');
		select.value = 'char-02-vrm';
		select.dispatchEvent(new Event('change', {bubbles:true}));
	})()`);
	await until("window.__cozyclay?.characterModel === 'char-02-vrm' && !!window.__cozyclay.rigA && window.__cozyclay.rigA !== window.__qaPreviousVrmRig");
	await evaluate("window.__qaChangedVrmRig = window.__cozyclay.rigA; true");
	await send("Input.dispatchKeyEvent", {type:"keyDown",key:"z",code:"KeyZ",modifiers:2,windowsVirtualKeyCode:90});
	await send("Input.dispatchKeyEvent", {type:"keyUp",key:"z",code:"KeyZ",modifiers:2,windowsVirtualKeyCode:90});
	await until("window.__cozyclay?.characterModel === 'sakura-vrm' && !!window.__cozyclay.rigA && window.__cozyclay.rigA !== window.__qaChangedVrmRig");
	console.log("PASS Inspector model selection and undo restore the avatar");
	const playback = await evaluate(`(async () => {
		const { loadVrm, vrmRuntime, disposeVrm, setVrmStandingPose } = await import('/src/vrm-runtime.js');
		const {characterModelUrl} = await import('/src/character-model-urls.js');
		const {applyMotionFrame,snapshotPlaybackBones,restorePlaybackBones} = await import('/src/ardy/playback.js');
		const {loadMotionFromUrl} = await import('/src/ardy/npz.js');
		const source = await loadMotionFromUrl('/demo/walk-then-stop.npz');
		const first = await loadVrm(characterModelUrl('sakura-vrm'));
		const second = await loadVrm(characterModelUrl('sakura-vrm'));
		try {
			setVrmStandingPose(first); setVrmStandingPose(second);
			const one = vrmRuntime(first), two = vrmRuntime(second);
			const before = two.hips.position.toArray();
			const baseline = snapshotPlaybackBones(first);
			const pose = () => one.bones.flatMap(b=>[...b.node.position.toArray(),...b.node.quaternion.toArray()]);
			applyMotionFrame(first,source,0); const beginning = pose();
			applyMotionFrame(first,source,Math.min(80,source.frames-1)); const later = pose();
			applyMotionFrame(first,source,0); const again = pose();
			restorePlaybackBones(first,baseline);
			return {independent:one.hips!==two.hips && before.every((v,i)=>v===two.hips.position.toArray()[i]),finite:later.every(Number.isFinite),changed:later.some((v,i)=>Math.abs(v-beginning[i])>0.01),seek:beginning.every((v,i)=>Math.abs(v-again[i])<1e-6),restored:baseline.every(b=>Math.abs(b[0].quaternion.x-b[1])<1e-6)};
		} finally {disposeVrm(first);disposeVrm(second);}
	})()`);
	assert.ok(playback.independent && playback.finite && playback.changed && playback.seek && playback.restored, JSON.stringify(playback));
	console.log("PASS independent copies, reference motion, deterministic seek and restore");
	writeFileSync(join(output, "report.json"), JSON.stringify({initial,playback},null,2));
	console.log(`Evidence: ${output}`);
} finally { browser.close(); }
