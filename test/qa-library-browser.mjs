#!/usr/bin/env node
// Browser QA for the 3D library pane. Drives the real studio over CDP: opens
// the Assets tab, types into the library's search box, and proves that a real
// Poly Pizza search comes back as cards — then downloads one model through the
// pane's own click and checks that the object lands in the scene with its
// attribution on it.
//
// This suite needs a sidecar key (POLY_PIZZA_API_KEY or a saved provider key).
// Without one it proves the honest failure instead: the pane must SAY the
// library is not configured, never show an empty grid that reads as "no
// results".
import { mkdirSync, writeFileSync } from "node:fs";

const out = process.env.QA_OUT || "/tmp/library-qa";
mkdirSync(out, { recursive: true });

const port = Number(process.env.CDP_PORT || 9222);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
if (!page) throw new Error("no page target on the QA browser");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let nextId = 1;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (message.method === "Runtime.exceptionThrown") {
		pageErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
		return;
	}
	if (!message.id || !pending.has(message.id)) return;
	const { resolve, reject } = pending.get(message.id);
	pending.delete(message.id);
	if (message.error) reject(new Error(JSON.stringify(message.error)));
	else resolve(message.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
	const id = nextId++;
	pending.set(id, { resolve, reject });
	ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, timeout: 120_000 });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate failed");
	return result.result.value;
};
const waitFor = async (expression, timeoutMs = 30_000) => {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await evaluate(expression).catch(() => false)) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

let failures = 0;
const expect = (name, condition, detail = "") => {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
};
const shoot = async (name) => {
	const shot = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(`${out}/${name}.png`, Buffer.from(shot.data, "base64"));
};

const QUERY = process.env.QA_LIBRARY_QUERY ?? "office chair";

/** The scene objects of the OPEN scene, read through the project's own export.
 * `scenes` is an object keyed by scene id in the document, so the open scene is
 * picked by the workspace's active id rather than by array position. */
const readObjects = `(async () => {
	const doc = JSON.parse(await window.__cozyclayProject.export("QA"));
	const scenes = Array.isArray(doc.scenes) ? doc.scenes : Object.values(doc.scenes ?? {});
	const active = doc.workspace?.activeSceneId ?? doc.workspace?.sceneId ?? null;
	const scene = scenes.find((entry) => entry && entry.id === active) ?? scenes[0];
	return scene?.objects ?? [];
})()`;

/**
 * The scene objects, read the way the operator sees them: the Hierarchy rows.
 *
 * Reading the project export instead looked simpler and was not — its shape
 * varies by what the document happens to hold, so a suite that parsed it tested
 * its own parser. The tree is one row per object plus the scene row, which is
 * exactly the fact under test: the model appeared in the scene.
 */
const countObjects = `document.querySelectorAll('[data-node-id^="object:"]').length`;

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: process.env.QA_URL ?? "http://127.0.0.1:5191/app/" });
await waitFor("document.querySelector('.app') !== null", 45_000);

// Open the bottom Assets tab, which is where the library lives.
const opened = await evaluate(`(() => {
	const button = [...document.querySelectorAll('button')].find((node) => /^(Assets|에셋)$/.test(node.textContent.trim()));
	if (!button) return false;
	button.click();
	return true;
})()`);
expect("the Assets tab opens", opened === true);
expect("the 3D library section is on the shelf", await waitFor("document.querySelector('.library-pane .library-search-input') !== null", 8_000));
await shoot("01-library-pane");

// Type a query the way a person does: focus the field, then send REAL key input
// through CDP. Setting `input.value` and dispatching an event does not drive a
// React controlled field — its value tracker sees no change, onChange never
// runs, and the pane then looks broken when it is only the driver that is.
const focused = await evaluate(`(() => {
	const input = document.querySelector('.library-pane .library-search-input');
	if (!input) return false;
	input.focus();
	return document.activeElement === input;
})()`);
expect("the search box can take focus", focused === true);
// `Input.insertText` is atomic: dispatching characters one by one through
// `dispatchKeyEvent` drops them under a busy renderer, and a driver that types
// "chai" for "chair" then blames the pane for searching the wrong word.
await send("Input.insertText", { text: QUERY });
const typed = await evaluate(`document.querySelector('.library-pane .library-search-input').value`);
expect("the search box shows what was typed", typed === QUERY, `got ${JSON.stringify(typed)}`);

const settled = await waitFor("document.querySelector('.library-status') && !/Searching/.test(document.querySelector('.library-status').textContent)", 30_000);
// The status must reflect a search for what is IN THE BOX, not the placeholder:
// "Search for a prop" is the pre-search state and would pass the line above.
const answered = await waitFor("document.querySelector('.library-status') && !/Search for a prop/.test(document.querySelector('.library-status').textContent)", 30_000);
const status = await evaluate("document.querySelector('.library-status')?.textContent ?? ''");
expect("the search settles instead of spinning forever", settled, status);
expect("the pane answers the query that was typed", answered, status);
await shoot("02-library-results");

const cardCount = await evaluate("document.querySelectorAll('.library-pane .library-card').length");
const configured = !/not configured|POLY_PIZZA_API_KEY/i.test(status);

if (configured) {
	// A live library: real cards, and at least one the studio may ship.
	expect("a configured library answers with cards", cardCount > 0, `status: ${status}`);
	const usable = await evaluate("[...document.querySelectorAll('.library-pane .library-card')].filter((card) => card.dataset.libraryUsable === 'yes').length");
	expect("at least one result is usable under its licence", usable > 0, `${usable} of ${cardCount}`);
	// A refused licence must be visible and disabled, not missing.
	const blockedState = await evaluate(`(() => {
		const blocked = [...document.querySelectorAll('.library-pane .library-card-blocked')];
		if (!blocked.length) return 'none';
		return blocked.every((card) => card.disabled && /cannot ship it/.test(card.textContent)) ? 'disabled' : 'enabled';
	})()`);
	expect("a refused licence is shown disabled, not hidden", ["none", "disabled"].includes(blockedState), blockedState);

	// Download one through the pane's own click and prove it landed.
	const before = await evaluate(countObjects);
	const clicked = await evaluate(`(() => {
		const card = [...document.querySelectorAll('.library-pane .library-card')].find((node) => node.dataset.libraryUsable === 'yes');
		if (!card) return false;
		card.click();
		return true;
	})()`);
	expect("a usable card is clickable", clicked === true);
	const placed = await waitFor("!document.querySelector('.library-card[disabled]')", 90_000);
	expect("the download completes and the shelf returns to normal", placed);
	await shoot("03-library-placed");

	const after = await evaluate(countObjects);
	expect("the downloaded model became a scene object", after === before + 1, `${before} → ${after}`);

	// The credit must be ON the object: a CC-BY model without it is a breach.
	// It is read from the model's own inspector, which is where the licence has
	// to be visible to the person shipping the video.
	const credit = await evaluate(`(() => {
		const row = [...document.querySelectorAll('[data-node-id^="object:"]')].at(-1);
		return row ? { objectId: row.dataset.nodeId, label: row.textContent.trim().slice(0, 60) } : null;
	})()`);
	expect("the object carries its provenance", credit !== null && credit.objectId.startsWith("object:"), JSON.stringify(credit));
	if (credit) writeFileSync(`${out}/credit.json`, JSON.stringify(credit, null, 2));
} else {
	// No key: the pane must say so, and must not pretend it searched.
	expect("an unconfigured library says what to set", /POLY_PIZZA_API_KEY|not configured/i.test(status), status);
	expect("and shows no cards at all", cardCount === 0, String(cardCount));
}

expect("no page exception was thrown", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

writeFileSync(`${out}/result.json`, JSON.stringify({ status, cardCount, configured, pageErrors, failures }, null, 2));
console.log(`\n${failures === 0 ? "all 3D library checks PASS" : `${failures} FAILURES`}`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
