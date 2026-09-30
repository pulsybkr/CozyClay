#!/usr/bin/env node
/**
 * Pacing: measuring a slow take, and the monotone time warp that fixes it.
 *
 * The safety property this suite exists for is monotonicity. A warp that dips
 * backwards would show a pose out of order — a hand that lets go of a prop and
 * then grabs it again — and no amount of "it looks faster" justifies that. So
 * the warp is checked to be non-decreasing everywhere, to keep the first and
 * last frames, and to pass through every pinned pose of the action.
 */
import assert from "node:assert/strict";

import { CSKEL27_JOINTS } from "../src/ardy/cskel27.js";
import { deriveBoneOffsets, forwardKinematics } from "../src/ardy/convert.js";
import { canonicalCskel27Reference } from "../src/ardy/to-cskel27.js";
import {
	DEAD_AIR_SHARE,
	MAX_SPEEDUP,
	PACE_MIN_FRAMES,
	SLUGGISH_SPEED,
	STILL_SPEED,
	analyzePacing,
	buildPaceWarp,
	rootSpeeds,
	tightenPacing,
	warpMotion,
} from "../src/ardy/pace.js";

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };

const JOINTS = CSKEL27_JOINTS.length;
const BONE_OFFSETS = (() => {
	const skeleton = canonicalCskel27Reference();
	return deriveBoneOffsets(skeleton.posed_joints, skeleton.local_rot_mats);
})();

/**
 * A synthetic take: an identity rotation at every joint, on a root that walks
 * `distance` metres per frame over `moving` frames, with `lead` frames of
 * stillness before it and `tail` after. Identity rotations keep the fixture
 * honest — every difference the tests see comes from the root, never from a
 * rotation that happened to be convenient.
 */
function take({ fps = 24, lead = 0, moving = 24, tail = 0, distance = 0.05 } = {}) {
	const frames = lead + moving + tail;
	const rotMats = new Float32Array(frames * JOINTS * 9);
	const rootPos = new Float32Array(frames * 3);
	const posedJoints = new Float32Array(frames * JOINTS * 3);
	const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
	for (let f = 0; f < frames; f += 1) {
		for (let j = 0; j < JOINTS; j += 1) for (let k = 0; k < 9; k += 1) rotMats[(f * JOINTS + j) * 9 + k] = identity[k];
		// Still during the lead, walking during the middle, still during the tail.
		const step = f <= lead ? 0 : Math.min(f - lead, moving - 1);
		rootPos[f * 3] = step * distance;
		rootPos[f * 3 + 1] = 0;
		rootPos[f * 3 + 2] = 0;
		const positions = forwardKinematics(
			Array.from({ length: JOINTS }, () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]]),
			BONE_OFFSETS,
			[rootPos[f * 3], rootPos[f * 3 + 1], rootPos[f * 3 + 2]],
		);
		for (let j = 0; j < JOINTS; j += 1) {
			const p = (f * JOINTS + j) * 3;
			posedJoints[p] = positions[j][0];
			posedJoints[p + 1] = positions[j][1];
			posedJoints[p + 2] = positions[j][2];
		}
	}
	return { frames, fps, rotMats, rootPos, posedJoints, anchorFrame: 0 };
}

/* ------------------------------------------------------------- analysis ---- */

check("root speed is metres per second, read from the take's own frames", () => {
	const speeds = rootSpeeds(take({ moving: 4, distance: 0.05, fps: 24 }), 24);
	assert.equal(speeds.length, 3);
	// 5 cm per frame at 24 fps is 1.2 m/s.
	for (const speed of speeds) assert.ok(Math.abs(speed - 1.2) < 1e-6, String(speed));
});

check("a take too short to warp reports nothing to fix", () => {
	const pacing = analyzePacing(take({ moving: 4 }));
	assert.equal(pacing.issues.length, 0);
	assert.equal(pacing.verdict, "even");
	assert.equal(PACE_MIN_FRAMES, 8);
});

check("a walk that opens and closes on dead air is diagnosed as padded", () => {
	const pacing = analyzePacing(take({ lead: 20, moving: 24, tail: 20 }));
	assert.ok(pacing.issues.includes("padded-ends"), pacing.verdict);
	assert.ok(pacing.issues.includes("dead-air"), pacing.verdict);
	assert.equal(pacing.leadingStillFrames, 20);
	// 24 walking frames produce 23 moving speed INTERVALS, so the trailing run
	// of still intervals is one longer than the trailing run of still frames.
	assert.equal(pacing.trailingStillFrames, 20);
});

check("a take that only crawls is called sluggish, not dead", () => {
	const pacing = analyzePacing(take({ moving: 40, distance: 0.001 }));
	assert.ok(pacing.issues.includes("sluggish"), pacing.verdict);
	assert.ok(pacing.meanMovingSpeed < SLUGGISH_SPEED);
});

check("a pause in the middle is not dead air: it is a chosen beat", () => {
	const frames = 60;
	const rotMats = new Float32Array(frames * JOINTS * 9);
	const rootPos = new Float32Array(frames * 3);
	const posedJoints = new Float32Array(frames * JOINTS * 3);
	for (let f = 0; f < frames; f += 1) {
		// Nothing between frames 20 and 40; real travel before and after.
		const moving = f < 20 || f > 40;
		rootPos[f * 3] = moving ? (f < 20 ? f : frames - f) * 0.05 : 1;
	}
	const pacing = analyzePacing({ frames, fps: 24, rotMats, rootPos, posedJoints });
	assert.equal(pacing.leadingStillFrames, 0, "the take starts moving immediately");
	assert.ok(!pacing.issues.includes("padded-ends"), pacing.verdict);
});

/* ---------------------------------------------------------------- warp ---- */

check("the warp is monotone, pinned at both ends, and inside the take", () => {
	const pacing = analyzePacing(take({ lead: 16, moving: 24, tail: 16 }));
	const warp = buildPaceWarp(pacing, { frames: pacing.frames, fps: pacing.fps });
	assert.ok(warp, "a padded take gets a warp");
	let previous = -Infinity;
	for (let f = 0; f < warp.outFrames; f += 1) {
		const at = warp.at(f);
		assert.ok(at >= previous - 1e-9, `output frame ${f} went backwards: ${at} after ${previous}`);
		assert.ok(at >= 0 && at <= pacing.frames - 1, `output frame ${f} left the take: ${at}`);
		previous = at;
	}
	assert.equal(warp.at(0), 0, "the take still starts on its own first pose");
	assert.equal(warp.at(warp.outFrames - 1), pacing.frames - 1, "and ends on its own last pose");
	assert.ok(warp.outFrames < pacing.frames, "the take got shorter, not longer");
});

check("no pose of the action is stepped over", () => {
	const pacing = analyzePacing(take({ lead: 12, moving: 30, tail: 12 }));
	const warp = buildPaceWarp(pacing, { frames: pacing.frames, fps: pacing.fps });
	const first = pacing.leadingStillFrames;
	const last = pacing.frames - 1 - pacing.trailingStillFrames;
	// Inside the action the warp must be DENSE: consecutive output frames can
	// never be more than one source frame apart, or a limb would visibly jump
	// from one pose to a later one. Padding is exempt on purpose — every frame
	// of it shows the same pose, and skipping identical poses is the point.
	for (let f = 0; f < warp.outFrames - 1; f += 1) {
		const here = warp.at(f);
		if (here < first - 1) continue;
		const next = warp.at(f + 1);
		if (next > last + 1) continue;
		assert.ok(next - here <= 1 + 1e-9, `output frames ${f}→${f + 1} jumped ${(next - here).toFixed(3)} source frames (${here.toFixed(2)} → ${next.toFixed(2)})`);
	}
	// And the action's own frames must all be sampled, not just bracketed.
	const sampled = new Set();
	for (let f = 0; f < warp.outFrames; f += 1) {
		const at = warp.at(f);
		sampled.add(Math.floor(at));
		sampled.add(Math.ceil(at));
	}
	for (let source = first; source <= last; source += 1) {
		assert.ok(sampled.has(source), `source frame ${source} of the action is never sampled`);
	}
});

check("a handful of frames is interpolated with sub-frame accuracy, not rounded", () => {
	const pacing = analyzePacing(take({ lead: 20, moving: 30, tail: 20 }));
	const warp = buildPaceWarp(pacing, { frames: pacing.frames, fps: pacing.fps });
	const values = Array.from({ length: warp.outFrames }, (_, f) => warp.at(f));
	// A warp that only ever lands on integers is a frame shuffle, not a warp:
	// the motion would visibly step instead of accelerating.
	assert.ok(values.some((value) => Math.abs(value - Math.round(value)) > 1e-6), values.join(","));
	assert.ok(values.some((value) => Math.round(value) !== Math.round(values[0] ?? 0)) || values.length < 3);
});

check("a take with nothing moving gets no warp at all", () => {
	const move = take({ moving: 1 });
	const pacing = analyzePacing(move);
	assert.equal(buildPaceWarp(pacing, { frames: pacing.frames, fps: pacing.fps }), null);
	assert.equal(buildPaceWarp(analyzePacing(take({ moving: 4 })), { frames: 4, fps: 24 }), null, "too short");
});

check("the requested speedup is bounded, never unbounded", () => {
	const pacing = analyzePacing(take({ lead: 30, moving: 30, tail: 30 }));
	const gentle = buildPaceWarp(pacing, { frames: pacing.frames, fps: pacing.fps, speedup: 1 });
	const hard = buildPaceWarp(pacing, { frames: pacing.frames, fps: pacing.fps, speedup: 0.01 });
	assert.ok(hard.scale >= 1 - MAX_SPEEDUP, `scale ${hard.scale} must respect the cap`);
	assert.ok(gentle.outFrames >= hard.outFrames, "asking for less speedup must not shorten more");
});

/* -------------------------------------------------------------- warped ---- */

check("the warped take keeps its frames, its clock and its bone lengths", () => {
	const source = take({ lead: 16, moving: 24, tail: 16 });
	const { motion: warped, changed, warp } = tightenPacing(source);
	assert.equal(changed, true);
	assert.equal(warped.fps, source.fps, "the clock did not change; the duration did");
	assert.equal(warped.frames, warp.outFrames);
	assert.ok(warped.frames < source.frames);
	assert.equal(warped.rotMats.length, warped.frames * JOINTS * 9);
	// Bone lengths are a property of the skeleton: regenerate them and they must
	// still hold, which is what stops the feet trembling.
	for (let f = 0; f < warped.frames; f += 3) {
		const locals = Array.from({ length: JOINTS }, (_, j) => {
			const o = (f * JOINTS + j) * 9;
			return [[warped.rotMats[o], warped.rotMats[o + 1], warped.rotMats[o + 2]], [warped.rotMats[o + 3], warped.rotMats[o + 4], warped.rotMats[o + 5]], [warped.rotMats[o + 6], warped.rotMats[o + 7], warped.rotMats[o + 8]]];
		});
		const positions = forwardKinematics(locals, BONE_OFFSETS, [warped.rootPos[f * 3], warped.rootPos[f * 3 + 1], warped.rootPos[f * 3 + 2]]);
		for (let j = 0; j < JOINTS; j += 1) {
			const p = (f * JOINTS + j) * 3;
			const drift = Math.hypot(positions[j][0] - warped.posedJoints[p], positions[j][1] - warped.posedJoints[p + 1], positions[j][2] - warped.posedJoints[p + 2]);
			assert.ok(drift < 1e-4, `frame ${f} joint ${j} drifted ${drift}`);
		}
	}
});

check("the ends' poses survive the warp", () => {
	const source = take({ lead: 12, moving: 24, tail: 12 });
	const { motion: warped } = tightenPacing(source);
	const lastSource = source.frames - 1;
	const lastOut = warped.frames - 1;
	assert.ok(Math.abs(warped.rootPos[0] - source.rootPos[0]) < 1e-6, "the take starts where it started");
	assert.ok(Math.abs(warped.rootPos[lastOut * 3] - source.rootPos[lastSource * 3]) < 1e-6, "and ends where it ended");
});

check("a take that is already well-paced is returned untouched, same object", () => {
	const source = take({ moving: 24, distance: 0.05 });
	const result = tightenPacing(source);
	assert.equal(result.changed, false);
	assert.equal(result.motion, source, "a no-op must not look like an edit in the history");
	assert.equal(result.warp, null);
});

check("the report says what was removed, in frames and seconds", () => {
	const { summary } = tightenPacing(take({ lead: 16, moving: 24, tail: 16 }));
	assert.match(summary, /leading and \d+ trailing still frames/);
	assert.match(summary, /\d+\.\d\ds to \d+\.\d\ds/);
});

check("the anchor follows its source frame through the warp", () => {
	const source = { ...take({ lead: 16, moving: 24, tail: 16 }), anchorFrame: 30 };
	const { motion: warped } = tightenPacing(source);
	assert.ok(Number.isInteger(warped.anchorFrame) && warped.anchorFrame >= 0 && warped.anchorFrame < warped.frames, String(warped.anchorFrame));
	// The output frame the anchor lands on must show (at or before) source 30.
	assert.ok(warped.anchorFrame <= 30, "the anchor cannot move later in the take");
});

check("a malformed take is refused instead of half-warped", () => {
	assert.throws(() => warpMotion(null, { at: () => 0, outFrames: 2 }), /motion/);
	assert.throws(() => warpMotion({ frames: 4, fps: 24 }, null), /warp/);
	assert.equal(buildPaceWarp(null, {}), null);
	assert.equal(analyzePacing(null).issues.length, 0);
});

check("dead-air share and the still threshold are the documented constants", () => {
	assert.equal(DEAD_AIR_SHARE, 0.25);
	assert.equal(STILL_SPEED, 0.02);
	// A take at exactly the sluggish threshold is not called sluggish.
	const pacing = analyzePacing(take({ moving: 30, distance: SLUGGISH_SPEED / 24 }));
	assert.ok(!pacing.issues.includes("sluggish"), `${pacing.meanMovingSpeed} vs ${SLUGGISH_SPEED}`);
});

console.log(`pacing: ${checks.length} checks passed`);
