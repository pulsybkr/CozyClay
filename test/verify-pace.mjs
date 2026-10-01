#!/usr/bin/env node
/**
 * Pace: measuring a slow or padded take, and planning the fix as segments.
 *
 * The plan is what matters, because it is the studio's EXISTING mechanism:
 * `motion-edit.js` holds a take as contiguous source ranges with a speed each,
 * and `renderMotionEdit` re-encodes them. So the safety property to prove here
 * is not "the warp is monotone" — it is that the plan is a PARTITION of the
 * source: contiguous, ordered, non-overlapping, inside the take. A partition
 * played in order shows every pose of the action, which is what keeps a prop in
 * a hand and a foot on the ground.
 */
import assert from "node:assert/strict";

import { CSKEL27_JOINTS } from "../src/ardy/cskel27.js";
import { createMotionEdit, motionEditDuration, motionEditLayout, renderMotionEdit } from "../src/ardy/motion-edit.js";
import {
	DEAD_AIR_SHARE,
	MAX_PACE_SPEED,
	PACE_MIN_FRAMES,
	SLUGGISH_SPEED,
	STILL_SPEED,
	actionRange,
	analyzePacing,
	paceSegments,
	quantizeSpeed,
	rootSpeeds,
} from "../src/ardy/pace.js";
import { canonicalCskel27Reference } from "../src/ardy/to-cskel27.js";
import { deriveBoneOffsets, forwardKinematics } from "../src/ardy/convert.js";

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };

const JOINTS = CSKEL27_JOINTS.length;
const BONE_OFFSETS = (() => {
	const skeleton = canonicalCskel27Reference();
	return deriveBoneOffsets(skeleton.posed_joints, skeleton.local_rot_mats);
})();

/**
 * A synthetic take: identity rotations, and a root that travels `distance` per
 * frame over `moving` frames, with `lead` frames of stillness before it and
 * `tail` after. Identity rotations keep the fixture honest — every difference
 * the checks see comes from the root, never from a rotation that happened to be
 * convenient.
 */
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

/* ------------------------------------------------------------- analysis ---- */

check("root speed is metres per second, read from the take's own frames", () => {
	const speeds = rootSpeeds(take({ moving: 4, distance: 0.05 }), 24);
	assert.equal(speeds.length, 3, "one interval per pair of frames");
	// 5 cm per frame at 24 fps is 1.2 m/s.
	for (const speed of speeds) assert.ok(Math.abs(speed - 1.2) < 1e-6, String(speed));
});

check("a take too short to have a pace reports nothing to fix", () => {
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
	// The trailing run of still INTERVALS is one longer than the trailing run of
	// still FRAMES, because an interval sits between two frames.
	assert.equal(pacing.trailingStillFrames, 20);
});

check("a take that only ever crawls is called sluggish, not dead", () => {
	const pacing = analyzePacing(take({ moving: 40, distance: 0.001 }));
	assert.ok(pacing.issues.includes("sluggish"), pacing.verdict);
	assert.ok(pacing.meanMovingSpeed < SLUGGISH_SPEED, String(pacing.meanMovingSpeed));
});

check("a pause in the middle is a chosen beat, not dead air", () => {
	const frames = 60;
	const rotMats = new Float32Array(frames * JOINTS * 9);
	const rootPos = new Float32Array(frames * 3);
	const posedJoints = new Float32Array(frames * JOINTS * 3);
	for (let f = 0; f < frames; f += 1) {
		const moving = f < 20 || f > 40;
		rootPos[f * 3] = moving ? (f < 20 ? f : frames - f) * 0.05 : 1;
	}
	const pacing = analyzePacing({ frames, fps: 24, rotMats, rootPos, posedJoints });
	assert.equal(pacing.leadingStillFrames, 0, "the take starts moving immediately");
	assert.ok(!pacing.issues.includes("padded-ends"), pacing.verdict);
});

check("a well-paced take has nothing to fix", () => {
	const pacing = analyzePacing(take({ moving: 24, distance: 0.05 }));
	assert.deepEqual(pacing.issues, []);
	assert.equal(paceSegments(take({ moving: 24, distance: 0.05 })), null, "and no plan is built for it");
});

/* ----------------------------------------------------------------- range ---- */

check("the action range starts at the first real move and ends at the last", () => {
	const source = take({ lead: 12, moving: 30, tail: 12 });
	const pacing = analyzePacing(source);
	const range = actionRange(pacing);
	assert.ok(range);
	// Interval `f` covers frames f..f+1: 12 still intervals means the first real
	// move lands on frame 12, and it must be INSIDE the plan.
	assert.equal(range.sourceStart, 12, "the first moving frame is kept, not clipped off");
	assert.equal(range.sourceEnd, source.frames - 1 - 12);
	assert.ok(range.sourceEnd > range.sourceStart);
});

check("trimming can be refused, and then the whole take is the range", () => {
	const pacing = analyzePacing(take({ lead: 12, moving: 30, tail: 12 }));
	const range = actionRange(pacing, { trimEnds: false });
	assert.equal(range.sourceStart, 0);
	assert.equal(range.sourceEnd, pacing.frames - 1);
});

check("a take with no movement at all is not offered a plan", () => {
	// One moving frame in the middle of stillness: the diagnosis is padded, and
	// there is no action to play at any speed, so no segment plan is built.
	const still = take({ lead: 30, moving: 1, tail: 0 });
	const pacing = analyzePacing(still);
	assert.ok(pacing.meanMovingSpeed >= 0);
	assert.equal(paceSegments(still), null, "nothing to speed up and no action to keep");
});

check("a range is never inverted or empty, whatever the pacing says", () => {
	for (const lead of [0, 1, 5, 29, 60]) {
		const source = take({ lead, moving: 2, tail: 0 });
		const range = actionRange(analyzePacing(source));
		if (range) assert.ok(range.sourceStart < range.sourceEnd, `lead ${lead}: ${JSON.stringify(range)}`);
	}
});

/* ------------------------------------------------------------------ plan ---- */

check("the plan is a partition of the source: contiguous, ordered, inside it", () => {
	const source = take({ lead: 16, moving: 24, tail: 16 });
	const plan = paceSegments(source);
	assert.ok(plan, "a padded take gets a plan");
	const layout = motionEditLayout(plan.segments);
	assert.equal(layout.length, 1, "one range is enough and cannot reorder anything");
	const [segment] = layout;
	assert.ok(segment.sourceStart >= 0, "the range starts inside the take");
	assert.ok(segment.sourceEnd <= source.frames - 1, "and ends inside it");
	assert.ok(segment.sourceStart <= segment.sourceEnd, "and is not empty");
	assert.ok(segment.speed >= 1 && segment.speed <= MAX_PACE_SPEED, `speed ${segment.speed}`);
	assert.equal(segment.speed % 0.1 < 1e-9 || Math.abs((segment.speed * 10) % 1) < 1e-9, true, "speed sits on the studio's 0.1 grid");
});

check("the plan shortens a padded take without touching the action's frames", () => {
	const source = take({ lead: 16, moving: 24, tail: 16 });
	const plan = paceSegments(source);
	const before = motionEditDuration(createMotionEdit(source.frames));
	const after = motionEditDuration(plan.segments);
	assert.ok(after < before, `${after} must be shorter than ${before}`);
	// The action's own 24 frames are all still reachable through the plan.
	const firstAction = plan.segments[0].sourceStart;
	const lastAction = plan.segments[0].sourceEnd;
	assert.ok(firstAction >= 15 && firstAction <= 17, `first action frame ${firstAction}`);
	assert.ok(lastAction >= source.frames - 18, `last action frame ${lastAction}`);
	assert.equal(plan.trimmedLeadFrames, 16);
});

check("a sluggish take is played faster, a padded one only loses its padding", () => {
	const sluggish = paceSegments(take({ moving: 40, distance: 0.001 }));
	assert.ok(sluggish.speed > 1, `a crawling take is compressed, got ${sluggish.speed}`);
	assert.match(sluggish.summary, /Played the take at/);
	const padded = paceSegments(take({ lead: 20, moving: 24, tail: 20 }));
	assert.equal(padded.speed, 1, "a take that walks fine is not sped up");
	assert.match(padded.summary, /still frames at the ends/);
});

check("an explicit speedup is honoured, and capped", () => {
	const source = take({ lead: 16, moving: 24, tail: 16 });
	assert.equal(paceSegments(source, { speedup: 1.5 }).speed, 1.5);
	assert.equal(paceSegments(source, { speedup: 99 }).speed, MAX_PACE_SPEED, "a walk at 4x is a different performance");
	assert.equal(paceSegments(source, { speedup: 0.2 }).speed, 1, "this module never slows a take down");
});

check("a speed is always on the studio's grid and above its floor", () => {
	assert.equal(quantizeSpeed(0.3), 1);
	assert.equal(quantizeSpeed(1.44), 1.4);
	assert.equal(quantizeSpeed(1.46), 1.5);
	assert.equal(quantizeSpeed(9), MAX_PACE_SPEED);
	assert.equal(quantizeSpeed(Number.NaN), 1);
	for (const value of [1.03, 1.28, 1.87]) assert.equal(Math.round(quantizeSpeed(value) * 10) % 1, 0, String(value));
});

/* --------------------------------------------------------------- renders ---- */

check("the studio's own renderer accepts the plan and shortens the take", () => {
	const source = take({ lead: 16, moving: 24, tail: 16 });
	const plan = paceSegments(source);
	const rendered = renderMotionEdit(source, plan.segments);
	const expectedFrames = motionEditDuration(plan.segments);
	assert.equal(rendered.frames, expectedFrames, "the rendered take is exactly the planned duration");
	assert.ok(rendered.frames < source.frames);
	assert.equal(rendered.fps, source.fps, "the clock did not change; the duration did");
	assert.equal(rendered.rotMats.length, rendered.frames * JOINTS * 9);
	// Bone lengths are a property of the skeleton, and renderMotionEdit
	// regenerates positions by forward kinematics: if that ever regressed, the
	// feet would tremble and this is where it would show.
	for (let f = 0; f < rendered.frames; f += 3) {
		const locals = Array.from({ length: JOINTS }, (_, j) => {
			const o = (f * JOINTS + j) * 9;
			return [[rendered.rotMats[o], rendered.rotMats[o + 1], rendered.rotMats[o + 2]], [rendered.rotMats[o + 3], rendered.rotMats[o + 4], rendered.rotMats[o + 5]], [rendered.rotMats[o + 6], rendered.rotMats[o + 7], rendered.rotMats[o + 8]]];
		});
		const positions = forwardKinematics(locals, BONE_OFFSETS, [rendered.rootPos[f * 3], rendered.rootPos[f * 3 + 1], rendered.rootPos[f * 3 + 2]]);
		for (let j = 0; j < JOINTS; j += 1) {
			const p = (f * JOINTS + j) * 3;
			const drift = Math.hypot(positions[j][0] - rendered.posedJoints[p], positions[j][1] - rendered.posedJoints[p + 1], positions[j][2] - rendered.posedJoints[p + 2]);
			assert.ok(drift < 1e-4, `frame ${f} joint ${j} drifted ${drift}`);
		}
	}
});

check("the take still begins and ends on its own poses", () => {
	const source = take({ lead: 12, moving: 24, tail: 12 });
	const plan = paceSegments(source);
	const rendered = renderMotionEdit(source, plan.segments);
	const lastRendered = rendered.frames - 1;
	const lastSource = source.frames - 1;
	assert.ok(Math.abs(rendered.rootPos[0] - source.rootPos[0]) < 1e-6, "the take starts where the action starts");
	assert.ok(Math.abs(rendered.rootPos[lastRendered * 3] - source.rootPos[lastSource * 3]) < 1e-6, "and ends where the action ends");
});

check("the report says what was done, in the studio's own words", () => {
	const { summary } = paceSegments(take({ lead: 16, moving: 24, tail: 16 }));
	assert.match(summary, /still frames at the ends/);
	const fast = paceSegments(take({ lead: 16, moving: 24, tail: 16 }), { speedup: 1.5 });
	assert.match(fast.summary, /1\.5x/);
	assert.match(fast.summary, /dropped \d+\.\d\ds of still frames/);
});

check("a malformed take is refused instead of half-planned", () => {
	assert.equal(paceSegments(null), null);
	assert.equal(paceSegments({ frames: 2, fps: 24 }), null);
	assert.deepEqual(analyzePacing(null).issues, []);
	assert.deepEqual(rootSpeeds(null), []);
});

check("the thresholds are the documented constants", () => {
	assert.equal(DEAD_AIR_SHARE, 0.25);
	assert.equal(STILL_SPEED, 0.02);
	assert.equal(MAX_PACE_SPEED, 2);
	// A take at exactly the sluggish threshold is not called sluggish.
	const pacing = analyzePacing(take({ moving: 30, distance: SLUGGISH_SPEED / 24 }));
	assert.ok(!pacing.issues.includes("sluggish"), `${pacing.meanMovingSpeed} vs ${SLUGGISH_SPEED}`);
});

console.log(`pacing: ${checks.length} checks passed`);
