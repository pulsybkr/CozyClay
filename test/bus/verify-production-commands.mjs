import assert from "node:assert/strict";
import { test } from "node:test";
import { createAppContext } from "../../src/app-context.js";
import { createProductionDomain } from "../../src/domains/production.js";
import { createStudioAppActions } from "../../src/commands/index.js";

function setupProductionBusFixture() {
	const appContext = createAppContext();
	const productionDomain = createProductionDomain(appContext);

	// Setup action ports
	const ports = {
		...appContext.actionPorts,
		storeDomain: (name) => appContext.storeDomain(name),
		state: () => ({
			production: productionDomain.read(),
		}),
	};

	const registry = createStudioAppActions(ports);

	return {
		appContext,
		productionDomain,
		registry,
		dispose: () => productionDomain.dispose(),
	};
}

test("Production Commands: registration and availability", () => {
	const f = setupProductionBusFixture();
	try {
		const actionIds = f.registry.ids();
		assert.ok(actionIds.includes("production.connect"));
		assert.ok(actionIds.includes("production.fetch"));
		assert.ok(actionIds.includes("production.prepare"));
		assert.ok(actionIds.includes("production.read"));
		assert.ok(actionIds.includes("production.updateDraft"));
		assert.ok(actionIds.includes("production.acceptPlan"));
		assert.ok(actionIds.includes("production.runStage"));
		assert.ok(actionIds.includes("production.runUnit"));
		assert.ok(actionIds.includes("production.pause"));
		assert.ok(actionIds.includes("production.resume"));
		assert.ok(actionIds.includes("production.retry"));
		assert.ok(actionIds.includes("production.verify"));
		assert.ok(actionIds.includes("production.export"));
	} finally {
		f.dispose();
	}
});

test("Production Commands: connect, read, updateDraft, acceptPlan lifecycle", async () => {
	const f = setupProductionBusFixture();
	try {
		const doc = f.productionDomain.read();
		const prodId = doc.productionId;

		// 1. production.connect
		const fetchBefore = globalThis.fetch;
		globalThis.fetch = async () => new Response(JSON.stringify({ schemaVersion: "cozy-story-v1", projectId: "proj-abc", revision: "r1" }));
		const connRes = await f.registry.run("production.connect", {
			connectionId: "conn-123",
			projectId: "proj-abc",
		});
		globalThis.fetch = fetchBefore;
		assert.ok(connRes.output.manifest);
		assert.equal(f.productionDomain.read().source.projectId, "proj-abc");

		// 2. production.read (summary)
		const readRes = await f.registry.run("production.read", {
			productionId: prodId,
			scope: "summary",
		});
		assert.equal(readRes.output.data.productionId, prodId);
		assert.equal(readRes.output.data.sourceConnected, true);

		// 3. production.updateDraft
		const draftRes = await f.registry.run("production.updateDraft", {
			productionId: prodId,
			expectedPlanRevision: 0,
			operations: [
				{ op: "set-prop-height", sourceId: "prop1", heightMeters: 0.8 },
			],
		});
		assert.equal(draftRes.output.appliedCount, 1);
		assert.equal(draftRes.output.planRevision, 1);

		// 4. production.acceptPlan
		const acceptRes = await f.registry.run("production.acceptPlan", {
			productionId: prodId,
			expectedPlanRevision: 1,
		});
		assert.equal(acceptRes.output.accepted, true);
		assert.equal(f.productionDomain.read().plan.accepted, true);
	} finally {
		f.dispose();
	}
});

test("Production Commands: runUnit and pause/resume execution", async () => {
	const f = setupProductionBusFixture();
	try {
		const doc = f.productionDomain.read();
		const prodId = doc.productionId;

		// Inject mock units in plan
		f.productionDomain.writePlan((plan) => ({
			...plan,
			units: [
				{ id: "avatar_unit_1", kind: "avatar", stage: "avatar", inputHash: "hash-avatar-1", payload: { characterId: "CHAR_A" } },
			],
		}));

		// Run unit
		const unitRes = await f.registry.run("production.runUnit", {
			productionId: prodId,
			unitId: "avatar_unit_1",
			expectedInputHash: "hash-avatar-1",
		});
		assert.equal(unitRes.output.unitId, "avatar_unit_1");
		assert.equal(unitRes.output.result.ok, true);

		// Pause
		const pauseRes = await f.registry.run("production.pause", {
			productionId: prodId,
			runId: "run-fake",
		});
		assert.equal(pauseRes.output.status, "paused");
	} finally {
		f.dispose();
	}
});
