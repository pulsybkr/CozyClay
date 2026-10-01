#!/usr/bin/env node
/**
 * Motion generation is limited per CHARACTER, not per message.
 *
 * The rule exists so a retry loop cannot spend the user's credits: one take per
 * performer per message. "Per message" was too coarse for the case that
 * actually happens — a scene with two speakers needs two takes, and refusing
 * the second one forces the user to send a second message for no reason.
 *
 * These checks pin both halves: a second character IS admitted, and a second
 * attempt for the SAME character is still refused (including when the first
 * attempt was an action that named the character only in its receipt).
 */
import assert from "node:assert/strict";

import { createStudioTools } from "../bin/agent/studio-tools.mjs";

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };

const ACTION_INDEX = [
	{ id: "motion.generate", generation: "motion" },
	{ id: "motion.generateAllBlocks", generation: "motion" },
	{ id: "motion.generateFromVideo", generation: "motion" },
	{ id: "export.shotVideo" },
];

/** A hub double that records every action that actually reached the editor.
 * A `run_action` payload wraps the action id one level down (`args.action`),
 * which is what both the alias and a direct call arrive as. */
function hub({ affectedIds = [], status = "completed" } = {}) {
	const sent = [];
	return {
		sent,
		liveHub: {
			command: async (name, payload) => {
				// Two shapes reach the hub: an admitted call wraps the command in
				// `{ args: { action, args } }`, an unadmitted one IS the args object.
				sent.push(payload?.args?.action ?? payload?.action ?? name);
				return { ok: true, status, affectedIds, summary: "Done." };
			},
		},
	};
}

const toolsFor = (liveHub, gate, tool = "generate_motion") =>
	createStudioTools({ liveHub, workspaceHandle: "workspace", session: { actionIndex: ACTION_INDEX, generation: gate } })
		.find((entry) => entry.name === tool);

const beat = (characterId) => ({ characterId, source: { kind: "generate", beats: [{ text: "Walk" }], durationSeconds: 2 } });

await check("two different characters are both generated in one message", async () => {
	const { liveHub, sent } = hub();
	const gate = { used: false, failures: 0 };
	const tools = toolsFor(liveHub, gate);
	assert.equal((await tools.handler(beat("char-alex"))).status, "completed");
	assert.equal((await tools.handler(beat("char-beth"))).status, "completed", "the second performer is admitted");
	assert.deepEqual(sent, ["motion.generate", "motion.generate"], "both takes reached the editor");
});

await check("a second attempt for the SAME character is still refused", async () => {
	const { liveHub, sent } = hub();
	const tools = toolsFor(liveHub, { used: false, failures: 0 });
	await tools.handler(beat("char-alex"));
	await tools.handler(beat("char-beth"));
	await assert.rejects(() => tools.handler(beat("char-alex")), (error) => error.code === "GENERATION_LIMIT");
	assert.deepEqual(sent, ["motion.generate", "motion.generate"], "the refused retry never reached the editor");
});

await check("the refusal names the character, so the model understands why", async () => {
	const { liveHub } = hub();
	const tools = toolsFor(liveHub, { used: false, failures: 0 });
	await tools.handler(beat("char-alex"));
	const error = await tools.handler(beat("char-alex")).catch((value) => value);
	assert.match(error.message, /One motion generation per user message/);
	// The way out has to be in the message: a model told only "no" will ask the
	// user for a new message instead of moving the other performer.
	assert.match(error.message, /different character may still be generated/);
});

await check("an action that picks the active character keeps the message-level rule", async () => {
	const { liveHub, sent } = hub({ affectedIds: ["char-alex"] });
	const tools = toolsFor(liveHub, { used: false, failures: 0 }, "run_action");
	assert.equal((await tools.handler({ action: "motion.generateAllBlocks" })).status, "completed");
	// Nothing in the call named a character, so the message itself is spent.
	await assert.rejects(() => tools.handler({ action: "motion.generateAllBlocks" }), (error) => error.code === "GENERATION_LIMIT");
	await assert.rejects(() => tools.handler({ action: "motion.generateFromVideo", args: { instruction: "wave" } }), (error) => error.code === "GENERATION_LIMIT");
	assert.deepEqual(sent, ["motion.generateAllBlocks"], "only the first reached the editor");
});

await check("an unnamed action records the character its receipt touched", async () => {
	const { liveHub, sent } = hub({ affectedIds: ["char-alex"] });
	const tools = toolsFor(liveHub, { used: false, failures: 0 }, "run_action");
	await tools.handler({ action: "motion.generateAllBlocks" });
	// The receipt said char-alex, so that performer has had its take: a named
	// retry for the same character is a retry, not a new performer.
	await assert.rejects(() => tools.handler({ action: "motion.generate", args: { characterId: "char-alex" } }), (error) => error.code === "GENERATION_LIMIT");
	// A different performer is still free to move.
	assert.equal((await tools.handler({ action: "motion.generate", args: { characterId: "char-beth" } })).status, "completed");
	assert.deepEqual(sent, ["motion.generateAllBlocks", "motion.generate"]);
});

await check("an action that is not a generation is neither blocked nor consuming", async () => {
	const { liveHub, sent } = hub();
	const tools = toolsFor(liveHub, { used: false, failures: 0 }, "run_action");
	assert.equal((await tools.handler({ action: "export.shotVideo" })).status, "completed");
	assert.equal((await tools.handler({ action: "motion.generate", args: { characterId: "char-alex" } })).status, "completed");
	assert.equal((await tools.handler({ action: "export.shotVideo" })).status, "completed");
	assert.deepEqual(sent, ["export.shotVideo", "motion.generate", "export.shotVideo"]);
});

await check("a message-level gate still blocks everything when no character is named", async () => {
	const { liveHub } = hub();
	// The route's own gate object, with `used` already set by an earlier
	// unnamed action: named calls must still be judged on their own entry.
	const tools = toolsFor(liveHub, { used: true, failures: 0 }, "run_action");
	await assert.rejects(() => tools.handler({ action: "motion.generateAllBlocks" }), (error) => error.code === "GENERATION_LIMIT");
});

await check("the alias and the action share one ledger, in both orders", async () => {
	for (const [label, first, second] of [
		["alias then action", "generate_motion", "run_action"],
		["action then alias", "run_action", "generate_motion"],
	]) {
		const { liveHub, sent } = hub({ affectedIds: ["char-alex"] });
		const gate = { used: false, failures: 0 };
		const alias = toolsFor(liveHub, gate, "generate_motion");
		const action = toolsFor(liveHub, gate, "run_action");
		const call = (which, id) => (which === "generate_motion"
			? alias.handler(beat(id))
			: action.handler({ action: "motion.generate", args: beat(id) }));
		assert.equal((await call(first, "char-alex")).status, "completed", `${label}: the first starts`);
		assert.equal((await call(second, "char-beth")).status, "completed", `${label}: the other performer is admitted`);
		await assert.rejects(() => call(second, "char-alex"), (error) => error.code === "GENERATION_LIMIT", `${label}: the same performer twice is refused`);
		assert.equal(sent.length, 2, `${label}: exactly two takes reached the editor`);
	}
});

await check("one performer's broken rig does not spend another's retry budget", async () => {
	const attempts = [];
	const liveHub = {
		command: async (name, payload) => {
			// The payload arrives admitted (`{ args: { action, args } }`) or bare.
			const who = payload?.args?.args?.characterId ?? payload?.args?.characterId ?? null;
			attempts.push(who);
			return who === "char-alex"
				? { ok: false, code: "TARGET_NOT_READY", message: "rig not loaded" }
				: { ok: true, status: "completed", affectedIds: [who], summary: "Done." };
		},
	};
	const tools = toolsFor(liveHub, { used: false, failures: 0 });
	/* eslint-disable no-await-in-loop */
	await tools.handler(beat("char-alex")).catch(() => {});
	await tools.handler(beat("char-alex")).catch(() => {});
	// Alex has now had his two attempts: a third is refused...
	await assert.rejects(() => tools.handler(beat("char-alex")), (error) => error.code === "GENERATION_LIMIT");
	// ...while Marie, whose rig is fine, still generates on HER OWN budget.
	assert.equal((await tools.handler(beat("char-marie"))).status, "completed", "the other performer keeps her allowance");
	assert.deepEqual(attempts, ["char-alex", "char-alex", "char-marie"], "exactly two attempts for Alex and one for Marie reached the editor");
});

await check("the retry refusal names the character it is about", async () => {
	const failing = { command: async () => ({ ok: false, code: "TARGET_NOT_READY", message: "rig not loaded" }) };
	const tools = createStudioTools({ liveHub: failing, workspaceHandle: "workspace", session: { actionIndex: ACTION_INDEX, generation: { used: false, failures: 0 } } })
		.find((entry) => entry.name === "generate_motion");
	await tools.handler(beat("char-alex")).catch(() => {});
	await tools.handler(beat("char-alex")).catch(() => {});
	const error = await tools.handler(beat("char-alex")).catch((value) => value);
	assert.match(error.message, /char-alex/, "the message says which performer is out of attempts");
	assert.match(error.message, /another character may still be generated/);
});

console.log(`motion generation per character: ${checks.length} checks passed`);
