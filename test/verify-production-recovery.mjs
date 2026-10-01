#!/usr/bin/env node
/**
 * Test suite for production controller recovery, dependency validation,
 * native failure rejection, and topological execution order.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { compile } from "../src/production/compiler.js";
import { createProductionController } from "../src/production/controller.js";
import { createRunStore } from "../src/production/run-store.js";
import { createAppContext } from "../src/app-context.js";
import { createProductionDomain } from "../src/domains/production.js";

function makeMinimalSnapshot() {
	return {
		schemaVersion: "cozy-story-v1",
		projectId: "proj_recov",
		revision: "r1",
		title: "Recovery Test Story",
		project: { fps: 24, aspect: "9:16", durationSeconds: 6 },
		characters: [
			{ id: "CHAR_A", name: "Alice", appearance: "Blue shirt", heightMeters: 1.7 },
		],
		sets: [
			{ id: "SET_01", name: "Room", props: [{ id: "DESK", name: "Desk", heightMeters: 0.75 }] },
		],
		scenes: [
			{ id: "SCENE_01", setId: "SET_01", globalStartSeconds: 0, globalEndSeconds: 6, cast: [{ characterId: "CHAR_A" }] },
		],
		shots: [
			{ id: "SHOT_01", sceneId: "SCENE_01", startSeconds: 0, endSeconds: 6 },
		],
		actions: [
			{ id: "ACT_01", characterId: "CHAR_A", sceneId: "SCENE_01", kind: "body", description: "Alice waves happily", startSeconds: 0, endSeconds: 3 },
		],
		narration: [],
	};
}

test("Recovery: unsatisfied dependencies throw DEPENDENCY_NOT_MET and mark unit as blocked", async () => {
	const snapshot = makeMinimalSnapshot();
	const { plan } = compile(snapshot);
	assert.ok(plan, "compile must produce valid plan");

	const appContext = createAppContext();
	const productionDomain = createProductionDomain(appContext);
	const store = createRunStore();

	const controller = createProductionController({
		productionDomain,
		runStore: store,
	});

	// Find a shot unit that depends on scene unit
	const shotUnit = plan.plan.units.find((u) => u.kind === "shot");
	assert.ok(shotUnit, "shot unit must exist");
	assert.ok(shotUnit.dependsOn.length > 0, "shot unit must have dependencies");

	// Attempt to execute shot unit directly before its scene dependency is done
	await assert.rejects(
		async () => {
			await controller.executeUnit(shotUnit, 1);
		},
		(err) => {
			assert.equal(err.code, "DEPENDENCY_NOT_MET");
			return true;
		}
	);

	// Check that unit is recorded as blocked in run-store
	const state = store.getUnitState(shotUnit.id);
	assert.equal(state.state, "blocked");
	assert.equal(state.inputHash, shotUnit.inputHash);
});

test("Recovery: native installation rejection marks unit as failed, never done", async () => {
	const snapshot = makeMinimalSnapshot();
	const { plan } = compile(snapshot);

	const appContext = createAppContext();
	const productionDomain = createProductionDomain(appContext);
	const store = createRunStore();

	// Mock bus that always rejects commands
	const failingBus = {
		run: async () => {
			throw new Error("Three.js renderer context lost / Native failure");
		},
	};

	const controller = createProductionController({
		productionDomain,
		bus: failingBus,
		runStore: store,
	});

	const sceneUnit = plan.plan.units.find((u) => u.kind === "scene");
	assert.ok(sceneUnit, "scene unit must exist");

	await assert.rejects(
		async () => {
			await controller.executeUnit(sceneUnit, 1);
		},
		(err) => {
			assert.ok(err.message.includes("Native") || err.message.includes("renderer"));
			return true;
		}
	);

	const state = store.getUnitState(sceneUnit.id);
	assert.equal(state.state, "failed");
	assert.notEqual(state.state, "done");
});

test("Recovery: startRun topological order guarantees dependencies execute before dependents", async () => {
	const snapshot = makeMinimalSnapshot();
	const { plan } = compile(snapshot);

	const appContext = createAppContext();
	const productionDomain = createProductionDomain(appContext);
	productionDomain.writePlan(plan.plan);

	const executedOrder = [];
	const workingBus = {
		run: async (cmd, args) => {
			return { ok: true, affectedIds: ["native_id"] };
		},
	};

	const controller = createProductionController({
		productionDomain,
		bus: workingBus,
		handlers: { "motion-clip": async () => ({ artifactRef: { kind: "test-motion" } }), install: { "motion-clip": async () => ({ ok: true }) } },
	});

	const res = await controller.startRun({
		onProgress: ({ event }) => {
			if (event?.type === "unit.started") {
				executedOrder.push(event.unitId);
			}
		},
	});

	assert.equal(res.status, "completed");

	// Verify that scene unit was started before its shot unit
	const sceneIdx = executedOrder.findIndex((id) => id.startsWith("unit_scene"));
	const shotIdx = executedOrder.findIndex((id) => id.startsWith("unit_shot"));
	assert.ok(sceneIdx !== -1, "scene must be executed");
	assert.ok(shotIdx !== -1, "shot must be executed");
	assert.ok(sceneIdx < shotIdx, "scene unit must execute BEFORE shot unit");
});

test("Recovery: inputHash is preserved in checkpoint and unit assessment", async () => {
	const store = createRunStore();
	store.appendEvent({
		runId: "run_test",
		unitId: "unit_desk",
		inputHash: "hash_desk_123",
		state: "done",
		message: "Completed desk",
	});

	const state = store.getUnitState("unit_desk");
	assert.equal(state.inputHash, "hash_desk_123");

	const checkpoint = store.exportCheckpoint();
	const cpUnit = checkpoint.units.find((u) => u.unitId === "unit_desk");
	assert.ok(cpUnit);
	assert.equal(cpUnit.inputHash, "hash_desk_123");
});
