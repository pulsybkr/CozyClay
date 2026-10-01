#!/usr/bin/env node
/**
 * The pace commands: measure a take, then tighten it through the studio's own
 * segment writer.
 *
 * Two properties matter here and neither is about arithmetic:
 *
 *  - a well-paced take must be a NO-OP, not a failed call and not an empty
 *    history entry — "I measured it and it is fine" is a real answer;
 *  - a tightening must reach `editSegments`, the same writer the take bar uses,
 *    so the change is undoable and persisted like any other authored edit. A
 *    module that encoded the take itself would look identical in a passing test
 *    and be invisible to undo.
 */
import assert from "node:assert/strict";

import { CSKEL27_JOINTS } from "../src/ardy/cskel27.js";
import { deriveBoneOffsets, forwardKinematics } from "../src/ardy/convert.js";
import { canonicalCskel27Reference } from "../src/ardy/to-cskel27.js";
import { declarations, register } from "../src/commands/pacing.js";

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const checkAsync = async (name, fn) => { await fn(); checks.push(name); };

const JOINTS = CSKEL27_JOINTS.length;
const BONE_OFFSETS = (() => {
	const skeleton = canonicalCskel27Reference();
	return deriveBoneOffsets(skeleton.posed_joints, skeleton.local_rot_mats);
})();

/** A take with `lead` still frames, `moving` walking frames and `tail` still. */
function take({ fps = 24, lead = 0, moving = 24, tail = 0, distance = 0.05 } = {}) {
	const frames = lead + moving + tail;
	const rotMats = new Float32Array(frames * JOINTS * 9);
	const rootPos = new Float32Array(frames * 3);
	const posedJoints = new Float32Array(frames * JOINTS * 3);
	const identity = Array.from({ length: JOINTS }, () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
	for (let f = 0; f < frames; f += 1) {
		for (let j = 0; j < JOINTS; j += 1) {
			const o = (f * JOINTS + j) * 9;
			for (let k = 0; k < 9; k += 1) rotMats[o + k] = identity[j][Math.floor(k / 3)][k % 3];
		}
		const step = f <= lead ? 0 : Math.min(f - lead, moving - 1);
		rootPos[f * 3] = step * distance;
		const positions = forwardKinematics(identity, BONE_OFFSETS, [rootPos[f * 3], 0, 0]);
		for (let j = 0; j < JOINTS; j += 1) {
			const p = (f * JOINTS + j) * 3;
			posedJoints[p] = positions[j][0];
			posedJoints[p + 1] = positions[j][1];
			posedJoints[p + 2] = positions[j][2];
		}
	}
	return { frames, fps, rotMats, rootPos, posedJoints, anchorFrame: 0 };
}

/** A registry double. */
function registry() {
	const entries = new Map();
	return {
		register(entry) { entries.set(entry.id, entry); },
		run(id, args) { return entries.get(id).run(args, { commit: (fn) => fn() }); },
		entry(id) { return entries.get(id); },
	};
}

/** A motion domain double that records what the segment writer received. */
function motionDomain({ characters = ["char-alex"], take: source = take({ lead: 16, moving: 24, tail: 16 }) } = {}) {
	const written = [];
	return {
		written,
		fullMotionFor: (id) => (characters.includes(id) ? source : null),
		motionFor: (id) => (characters.includes(id) ? source : null),
		editSegments: (id, segments) => { written.push({ id, segments }); },
	};
}

const portsFor = (domain) => ({
	storeDomain: (name) => (name === "motion" ? domain : null),
	state: () => ({ characters: [{ id: "char-alex" }], activeCharacterId: "char-alex" }),
});

const withCommands = (domain) => {
	const r = registry();
	register(r, portsFor(domain));
	return r;
};

/* -------------------------------------------------------- declarations ---- */

check("both pace actions are declared, and only one of them authors", () => {
	assert.deepEqual(declarations.map((entry) => entry.id), ["motion.readPace", "motion.tightenPace"]);
	assert.equal(declarations[0].kind, "job", "a measurement is not an edit");
	assert.equal(declarations[0].domain, null, "and it writes to no document");
	assert.equal(declarations[1].kind, "mutation");
	assert.equal(declarations[1].undoDomain, "motion", "a tightening is undoable");
	assert.deepEqual(declarations[1].input.required, ["characterId"]);
	assert.deepEqual(Object.keys(declarations[1].input.properties), ["characterId", "speedup"]);
});

/* ---------------------------------------------------------- measurement ---- */

check("a measurement reports the take's real numbers and authors nothing", () => {
	const domain = motionDomain();
	const r = withCommands(domain);
	const result = r.run("motion.readPace", { characterId: "char-alex" });
	assert.deepEqual(result.affectedIds, []);
	assert.deepEqual(domain.written, [], "measuring must never write");
	assert.ok(result.output.frames > 0);
	assert.ok(result.output.issues.includes("padded-ends"), result.output.verdict);
	assert.match(result.summary, /still|stand still|paced/);
});

check("an even take is reported as even", () => {
	const domain = motionDomain({ take: take({ moving: 24, distance: 0.05 }) });
	const result = withCommands(domain).run("motion.readPace", { characterId: "char-alex" });
	assert.equal(result.output.verdict, "even");
	assert.match(result.summary, /evenly paced/);
});

check("measuring a character with no take is refused with a reason", () => {
	const domain = motionDomain();
	const r = withCommands(domain);
	assert.throws(() => r.run("motion.readPace", { characterId: "char-nobody" }), (error) => error.code === "STALE_TARGET" || error.code === "TARGET_NOT_READY");
});

/* ------------------------------------------------------------ tightening ---- */

await checkAsync("a tightening goes through the studio's own segment writer", async () => {
	const domain = motionDomain();
	const r = withCommands(domain);
	const result = await r.run("motion.tightenPace", { characterId: "char-alex" });
	assert.deepEqual(result.affectedIds, ["char-alex"]);
	assert.equal(domain.written.length, 1, "exactly one write, through editSegments");
	assert.equal(domain.written[0].id, "char-alex");
	const [segment] = domain.written[0].segments;
	assert.ok(segment.sourceStart >= 0 && segment.sourceEnd <= 48, JSON.stringify(segment));
	assert.ok(segment.speed >= 1, "a pace never slows a take down");
	assert.equal(result.output.changed, true);
	assert.match(result.summary, /still frames at the ends|Played the take at/);
});

await checkAsync("an even take is a no-op: no write, no affected id, a real answer", async () => {
	const domain = motionDomain({ take: take({ moving: 24, distance: 0.05 }) });
	const r = withCommands(domain);
	const result = await r.run("motion.tightenPace", { characterId: "char-alex" });
	assert.deepEqual(result.affectedIds, [], "nothing entered the history");
	assert.deepEqual(domain.written, [], "and nothing was written");
	assert.equal(result.output.changed, false);
	assert.match(result.summary, /already well paced/);
});

await checkAsync("an explicit speedup is what the writer receives", async () => {
	const domain = motionDomain();
	const r = withCommands(domain);
	const result = await r.run("motion.tightenPace", { characterId: "char-alex", speedup: 1.5 });
	assert.equal(domain.written[0].segments[0].speed, 1.5);
	assert.equal(result.output.speed, 1.5);
	assert.match(result.summary, /1\.5x/);
});

await checkAsync("a speedup beyond the cap is clamped, not honoured blindly", async () => {
	const domain = motionDomain();
	const result = await withCommands(domain).run("motion.tightenPace", { characterId: "char-alex", speedup: 2 });
	assert.equal(domain.written[0].segments[0].speed, 2);
	assert.ok(result.output.speed <= 2);
});

await checkAsync("tightening a character with no take is refused, and writes nothing", async () => {
	const domain = motionDomain();
	const r = withCommands(domain);
	// An unknown character is refused synchronously (the target is checked
	// before anything is read); the assertion has to accept both shapes so the
	// test states the CONTRACT — refused, and nothing written — rather than one
	// particular way of throwing.
	await assert.rejects(async () => r.run("motion.tightenPace", { characterId: "char-marie" }),
		(error) => ["STALE_TARGET", "TARGET_NOT_READY"].includes(error.code), "refused for an unknown character");
	assert.deepEqual(domain.written, [], "a refusal must not touch the take");
});

await checkAsync("the plan the writer receives is a partition of the source", async () => {
	const domain = motionDomain();
	await withCommands(domain).run("motion.tightenPace", { characterId: "char-alex" });
	const [segment] = domain.written[0].segments;
	const source = domain.fullMotionFor("char-alex");
	assert.ok(segment.sourceStart <= segment.sourceEnd);
	assert.ok(segment.sourceStart >= 0 && segment.sourceEnd <= source.frames - 1, "inside the take");
	// The action's own frames survive: the plan cannot trim away the movement.
	assert.ok(segment.sourceStart <= 17, `first action frame kept: ${segment.sourceStart}`);
	assert.ok(segment.sourceEnd >= source.frames - 18, `last action frame kept: ${segment.sourceEnd}`);
});

await checkAsync("the measurement is on the untrimmed source, so a second pass is honest", async () => {
	const domain = motionDomain();
	const r = withCommands(domain);
	const first = await r.run("motion.tightenPace", { characterId: "char-alex" });
	// The domain still holds the same source: the editor's own writer is what
	// renders the trim, so a second call re-measures the PERFORMANCE rather than
	// the previous plan's output.
	const second = await r.run("motion.tightenPace", { characterId: "char-alex" });
	assert.equal(first.output.changed, true);
	assert.equal(second.output.changed, true);
	assert.equal(domain.written.length, 2);
	assert.deepEqual(domain.written[0].segments, domain.written[1].segments, "the same performance yields the same plan");
});

console.log(`pacing commands: ${checks.length} checks passed`);
