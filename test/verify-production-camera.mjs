#!/usr/bin/env node
/**
 * Test suite for camera planning, semantic framing, and keyframe generation (Lot 5).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	degToRad,
	radToDeg,
	planCameraFraming,
	generateShotCameraKeys,
	ASPECT_RATIOS,
} from "../src/production/camera-planner.js";

test("Camera Planner: angle conversion between degrees and radians", () => {
	assert.equal(degToRad(0), 0);
	assert.ok(Math.abs(degToRad(90) - Math.PI / 2) < 1e-6);
	assert.ok(Math.abs(degToRad(180) - Math.PI) < 1e-6);
	assert.ok(Math.abs(degToRad(-45) - (-Math.PI / 4)) < 1e-6);

	assert.equal(radToDeg(0), 0);
	assert.ok(Math.abs(radToDeg(Math.PI / 2) - 90) < 1e-6);
	assert.ok(Math.abs(radToDeg(Math.PI) - 180) < 1e-6);
});

test("Camera Planner: computes framing for 9:16 portrait and 16:9 landscape", () => {
	const target = { x: 0, y: 0, z: 0, height: 1.75 };

	const portrait = planCameraFraming({
		target,
		shotType: "medium",
		aspectRatio: "9:16",
		fovDeg: 35,
	});

	const landscape = planCameraFraming({
		target,
		shotType: "medium",
		aspectRatio: "16:9",
		fovDeg: 35,
	});

	// In portrait (9:16), horizontal FOV is narrower, requiring greater distance to frame the subject
	const portraitDist = Math.hypot(portrait.pos.x - target.x, portrait.pos.z - target.z);
	const landscapeDist = Math.hypot(landscape.pos.x - target.x, landscape.pos.z - target.z);

	assert.ok(portraitDist > landscapeDist, `portrait distance (${portraitDist}) should exceed landscape distance (${landscapeDist})`);
	assert.ok(portrait.pos.y > 0, "camera eye height must be positive above floor");
});

test("Camera Planner: semantic framing presets position closer for close-up than wide", () => {
	const target = { x: 1, y: 0, z: -1, height: 1.8 };

	const cu = planCameraFraming({ target, shotType: "close-up", yawDeg: 0 });
	const wide = planCameraFraming({ target, shotType: "wide", yawDeg: 0 });

	const cuDist = Math.hypot(cu.pos.x - target.x, cu.pos.z - target.z);
	const wideDist = Math.hypot(wide.pos.x - target.x, wide.pos.z - target.z);

	assert.ok(cuDist < wideDist, `close-up distance (${cuDist}) must be less than wide distance (${wideDist})`);
});

test("Camera Planner: room bounds clamp camera within walls", () => {
	const target = { x: 0, y: 0, z: 0, height: 1.7 };
	const roomBounds = {
		min: { x: -2, y: 0, z: -2 },
		max: { x: 2, y: 3, z: 2 },
	};

	// A wide shot in 9:16 that would normally be at distance ~4m is clamped inside roomBounds [-2, 2]
	const framed = planCameraFraming({
		target,
		shotType: "establishing",
		aspectRatio: "9:16",
		roomBounds,
	});

	assert.ok(framed.pos.z <= roomBounds.max.z, "camera Z must not exceed room max Z");
	assert.ok(framed.pos.z >= roomBounds.min.z, "camera Z must not be below room min Z");
	assert.ok(framed.pos.x <= roomBounds.max.x, "camera X must not exceed room max X");
	assert.ok(framed.pos.x >= roomBounds.min.x, "camera X must not be below room min X");
});

test("Camera Planner: generates keyframes at local frame 0 and duration - 1", () => {
	const startFraming = {
		pos: { x: 0, y: 1.5, z: 3 },
		yaw: 0,
		pitch: 0,
		fovDeg: 35,
	};
	const endFraming = {
		pos: { x: 0, y: 1.5, z: 2 },
		yaw: 0.1,
		pitch: -0.05,
		fovDeg: 35,
	};

	const keys = generateShotCameraKeys({
		durationFrames: 96,
		startFraming,
		endFraming,
	});

	assert.equal(keys.length, 2);
	assert.equal(keys[0].frame, 0, "first key is at frame 0");
	assert.equal(keys[1].frame, 95, "second key is at frame 95 (durationFrames - 1)");
	assert.deepEqual(keys[0].framing.pos, startFraming.pos);
	assert.deepEqual(keys[1].framing.pos, endFraming.pos);
});
