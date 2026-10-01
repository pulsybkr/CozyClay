#!/usr/bin/env node
/**
 * Test suite for pure 3D production compilation (Lot 5).
 * Tests compile(snapshot, overrides, capabilities) on canonical fixtures and error cases.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "../src/production/compiler.js";
import { validateProductionDocument } from "../src/production/plan-contract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures", "production");

function readJsonFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8"));
}

test("Compiler: compiles office-12s fixture deterministically without side effects", () => {
	const snapshot = readJsonFixture("office-12s.json");
	const originalCopy = JSON.parse(JSON.stringify(snapshot));

	const result = compile(snapshot);

	// Snapshot must not be mutated
	assert.deepEqual(snapshot, originalCopy, "compiler must not mutate input snapshot");

	assert.equal(result.errors.length, 0, "must compile without errors");
	assert.ok(result.plan, "plan must be produced");

	// Validate against production document schema
	const val = validateProductionDocument(result.plan);
	assert.ok(val.valid, `plan validation failed: ${JSON.stringify(val.errors)}`);

	// Frame rate and duration: 12 seconds * 24 fps = 288 frames
	assert.equal(result.plan.plan.fps, 24);
	assert.equal(result.plan.plan.frameCount, 288);

	// Sequence entries: 3 shots
	const seq = result.plan.plan.sequence;
	assert.equal(seq.length, 3);
	assert.equal(seq[0].globalStartFrame, 0);
	assert.equal(seq[0].globalEndFrameExclusive, 96);
	assert.equal(seq[1].globalStartFrame, 96);
	assert.equal(seq[1].globalEndFrameExclusive, 192);
	assert.equal(seq[2].globalStartFrame, 192);
	assert.equal(seq[2].globalEndFrameExclusive, 288);

	// Verify prop support surface: CUP placed on DESK
	const structUnit = result.plan.plan.units.find((u) => u.kind === "structure");
	assert.ok(structUnit, "structure unit must exist");
	const desk = structUnit.payload.props.find((p) => p.id === "DESK");
	const cup = structUnit.payload.props.find((p) => p.id === "CUP");
	assert.ok(desk && cup, "desk and cup must be compiled");
	assert.equal(desk.y, 0, "desk stands on floor");
	assert.equal(cup.y, 0.75, "cup rests at desk top height (y=0.75)");

	// Hypotheses emitted
	assert.ok(result.hypotheses.length > 0, "hypotheses must be emitted");
	const cupHyp = result.hypotheses.find((h) => h.id === "hyp_support_CUP");
	assert.ok(cupHyp, "cup support hypothesis must be emitted");
	assert.equal(cupHyp.chosenValue.y, 0.75);
});

test("Compiler: compiles story-30s fixture", () => {
	const snapshot = readJsonFixture("story-30s.json");
	const result = compile(snapshot);

	assert.equal(result.errors.length, 0, "must compile story-30s without errors");
	assert.ok(result.plan, "plan must be produced");
	assert.equal(result.plan.plan.frameCount, 720, "30s * 24fps = 720 frames");

	const val = validateProductionDocument(result.plan);
	assert.ok(val.valid, `plan validation failed: ${JSON.stringify(val.errors)}`);
});

test("Compiler: detects unknown character references in actions", () => {
	const snapshot = readJsonFixture("office-12s.json");
	snapshot.actions.push({
		id: "ACT_INVALID",
		kind: "body",
		sceneId: "SCENE_01",
		characterId: "NON_EXISTENT_CHAR",
		startSeconds: 0,
		endSeconds: 2,
		description: "Invisible ghost",
	});

	const result = compile(snapshot);
	assert.equal(result.plan, null, "plan must be null on fatal error");
	const err = result.errors.find((e) => e.code === "UNKNOWN_ACTOR" || e.code === "SOURCE_REFERENCE_MISSING");
	assert.ok(err, "error for missing actor must be emitted");
	assert.equal(err.fatal, true);
});

test("Compiler: detects conflicting simultaneous body actions for same actor", () => {
	const snapshot = readJsonFixture("office-12s.json");
	// ACT_A_WALK is from 0 to 4s. Add another body action for CHAR_A from 2 to 5s.
	snapshot.actions.push({
		id: "ACT_A_DANCE",
		kind: "body",
		sceneId: "SCENE_01",
		characterId: "CHAR_A",
		startSeconds: 2,
		endSeconds: 5,
		description: "Alex breaks into dance while walking",
	});

	const result = compile(snapshot);
	assert.equal(result.plan, null, "plan must be null on conflicting body actions");
	const err = result.errors.find((e) => e.code === "CONFLICTING_ACTIONS");
	assert.ok(err, "CONFLICTING_ACTIONS error must be emitted");
	assert.equal(err.fatal, true);
});

test("Compiler: rejects invalid time intervals", () => {
	const snapshot = readJsonFixture("office-12s.json");
	snapshot.shots[0].startSeconds = 5;
	snapshot.shots[0].endSeconds = 2; // inverted

	const result = compile(snapshot);
	const err = result.errors.find((e) => e.code === "INVALID_SHOT_TIMING" || e.code === "INVALID_TIME");
	assert.ok(err, "error for invalid shot timing must be emitted");
});
