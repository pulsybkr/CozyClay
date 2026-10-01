import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createRunStore,
	computeIdempotencyKey,
	UNIT_STATES,
} from "../src/production/run-store.js";

test("RunStore: creates store with initial checkpoint", () => {
	const initialCheckpoint = {
		savedAt: "2026-10-01T12:00:00Z",
		units: [
			{ unitId: "unit-1", state: "done", installedAt: "2026-10-01T12:01:00Z" },
		],
	};
	const store = createRunStore(initialCheckpoint);

	assert.equal(store.getUnitState("unit-1")?.state, "done");
	assert.ok(!store.getUnitState("unit-2"));
});

test("RunStore: appendEvent updates unit state and event journal", () => {
	const store = createRunStore();

	store.registerRun({ runId: "run-101", planRevision: 1, unitIds: ["unit-A"] });

	store.appendEvent({
		runId: "run-101",
		unitId: "unit-A",
		attempt: 1,
		state: "running",
		phase: "prepare",
		message: "Starting execution",
	});

	const stateAfterRunning = store.getUnitState("unit-A");
	assert.equal(stateAfterRunning.state, "running");
	assert.equal(stateAfterRunning.attempts, 1);

	store.appendEvent({
		runId: "run-101",
		unitId: "unit-A",
		attempt: 1,
		state: "artifact-ready",
		phase: "artifact",
		resourceRefs: ["res-001"],
		message: "Artifact created",
	});

	assert.equal(store.getUnitState("unit-A").state, "artifact-ready");
	assert.deepEqual(store.getUnitState("unit-A").resourceRefs, ["res-001"]);

	store.appendEvent({
		runId: "run-101",
		unitId: "unit-A",
		attempt: 1,
		state: "done",
		phase: "complete",
		message: "Installed into scene",
	});

	assert.equal(store.getUnitState("unit-A").state, "done");

	const journal = store.getJournal();
	assert.equal(journal.length, 3);
	assert.equal(journal[0].sequence, 1);
	assert.equal(journal[1].sequence, 2);
	assert.equal(journal[2].sequence, 3);
});

test("RunStore: computeIdempotencyKey creates deterministic hash", () => {
	const key1 = computeIdempotencyKey({
		projectUuid: "proj-1",
		planRevision: 2,
		unitId: "unit-alpha",
		inputHash: "hash-12345",
	});

	const key2 = computeIdempotencyKey({
		projectUuid: "proj-1",
		planRevision: 2,
		unitId: "unit-alpha",
		inputHash: "hash-12345",
	});

	const key3 = computeIdempotencyKey({
		projectUuid: "proj-1",
		planRevision: 3,
		unitId: "unit-alpha",
		inputHash: "hash-12345",
	});

	assert.equal(key1, key2);
	assert.notEqual(key1, key3);
});

test("RunStore: exportCheckpoint and importCheckpoint roundtrip", () => {
	const store = createRunStore();
	store.appendEvent({
		runId: "run-1",
		unitId: "unit-1",
		state: "done",
		message: "Done",
	});

	const exported = store.exportCheckpoint();
	assert.equal(exported.units.length, 1);
	assert.equal(exported.units[0].unitId, "unit-1");
	assert.equal(exported.units[0].state, "done");

	const newStore = createRunStore(exported);
	assert.equal(newStore.getUnitState("unit-1").state, "done");
});
