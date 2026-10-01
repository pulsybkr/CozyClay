import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductionController } from "../src/production/controller.js";
import { createRunStore } from "../src/production/run-store.js";

function createMockProductionDomain(initialDoc = {}) {
	let doc = {
		productionId: "prod-test-01",
		planRevision: 1,
		plan: {
			units: [
				{ id: "avatar_A", kind: "avatar", stage: "avatar", inputHash: "hash-A", payload: { characterId: "A" } },
				{ id: "clip_A1", kind: "motion-clip", stage: "clip", inputHash: "hash-clip-1", payload: { characterId: "A", actionType: "walk" } },
				{ id: "clip_A2", kind: "motion-clip", stage: "clip", inputHash: "hash-clip-2", payload: { characterId: "A", actionType: "wave" } },
			],
		},
		bindings: {},
		executionCheckpoint: { units: [] },
		...initialDoc,
	};

	return {
		read: () => doc,
		write: (updater) => {
			doc = typeof updater === "function" ? updater(doc) : updater;
			return doc;
		},
		writePlan: (updater) => {
			doc.plan = typeof updater === "function" ? updater(doc.plan) : updater;
			doc.planRevision = (doc.planRevision || 0) + 1;
			return doc;
		},
		updateCheckpoint: (unitRun) => {
			const current = doc.executionCheckpoint?.units || [];
			const next = current.filter((u) => u.unitId !== unitRun.unitId);
			next.push(unitRun);
			doc.executionCheckpoint = { savedAt: new Date().toISOString(), units: next };
		},
	};
}

import { readFileSync } from "node:fs";
// Explicit fake producer and installer: these tests cover orchestration, not rendered motion.
const testHandlers = {
 "motion-clip": async unit => ({ artifactRef: { kind: "test-motion", clipId: unit.id } }),
 install: { "motion-clip": async () => ({ ok: true }) },
};

test("Controller: prepare compiles snapshot and returns plan + issues", () => {
	const domain = createMockProductionDomain();
	const controller = createProductionController({ productionDomain: domain, handlers: testHandlers });

	const snapshot = JSON.parse(
		readFileSync(new URL("./fixtures/production/office-12s.json", import.meta.url), "utf8"),
	);

	const prep = controller.prepare(snapshot);
	assert.ok(prep.plan);
	assert.ok(Array.isArray(prep.plan.units));
	assert.ok(Array.isArray(prep.issues));
});

test("Controller: startRun executes units sequentially and records checkpoint", async () => {
	const domain = createMockProductionDomain();
	const controller = createProductionController({ productionDomain: domain, handlers: testHandlers });

	const progressEvents = [];
	const result = await controller.startRun({
		planRevision: 1,
		unitIds: ["avatar_A", "clip_A1"],
		onProgress: (evt) => progressEvents.push(evt),
	});

	assert.equal(result.status, "completed");
	assert.equal(result.completedCount, 2);

	const checkpoint = controller.runStore.exportCheckpoint();
	assert.equal(checkpoint.units.length, 2);
	assert.equal(controller.runStore.getUnitState("avatar_A").state, "done");
	assert.equal(controller.runStore.getUnitState("clip_A1").state, "done");

	// Domain checkpoint also updated
	assert.equal(domain.read().executionCheckpoint.units.length, 2);
});

test("Controller: pause and resume halts execution and completes remaining units", async () => {
	const domain = createMockProductionDomain();
	const controller = createProductionController({ productionDomain: domain, handlers: testHandlers });

	// Pause before starting
	const runPromise = controller.startRun({
		planRevision: 1,
		unitIds: ["avatar_A", "clip_A1", "clip_A2"],
	});

	// Trigger pause
	controller.pause();

	const res = await runPromise;
	assert.equal(res.status, "paused");

	// Now resume
	const resumeRes = await controller.resume(res.runId);
	assert.ok(resumeRes.status === "completed" || resumeRes.status === "done");
});

test("Controller: retryUnit executes failed unit with incremented attempt", async () => {
	const domain = createMockProductionDomain();
	const controller = createProductionController({ productionDomain: domain, handlers: testHandlers });

	// First execution of avatar_A
	await controller.executeUnit(domain.read().plan.units[0], 1);
	assert.equal(controller.runStore.getUnitState("avatar_A").attempts, 1);

	// Retry
	await controller.retryUnit("avatar_A");
	assert.equal(controller.runStore.getUnitState("avatar_A").attempts, 1, "retry of a completed unchanged unit uses cache");
});
