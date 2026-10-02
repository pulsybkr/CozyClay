import assert from "node:assert/strict";
import { test } from "node:test";
import { createAppContext } from "../../src/app-context.js";
import { createProductionDomain } from "../../src/domains/production.js";
import { createStudioAppActions } from "../../src/commands/index.js";
import { readFileSync } from "node:fs";
import { createCommandBus } from "../../src/command-bus.js";
import { fixture as commandBusFixture } from "./fixture.mjs";

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

test("Production Commands: large narrative plan fits the receipt and retains all directives", async () => {
	const f = setupProductionBusFixture();
	const transport = commandBusFixture();
	const bus = createCommandBus({ registry: f.registry, ports: transport.ports });
	try {
		const source = JSON.parse(readFileSync(new URL("../fixtures/production/narrative-v2.json", import.meta.url), "utf8"));
		const longDirective = "Déplacer le personnage, observer le décor et préserver le raccord. 🎬 ".repeat(400);
		source.actions[0].description = longDirective;
		f.productionDomain.setSourceSnapshot(source);
		const productionId = f.productionDomain.read().productionId;
		const receipt = await bus.run("production.prepare", { productionId });
		assert.equal(receipt.ok, true, JSON.stringify(receipt));
		assert.equal(receipt.status, "completed");
		assert.ok(Buffer.byteLength(JSON.stringify(receipt), "utf8") <= 8192);
		assert.equal(receipt.output.plan, undefined);
		const saved = f.productionDomain.read();
		assert.ok(Buffer.byteLength(JSON.stringify(saved.plan), "utf8") > 8192);
		assert.equal(saved.plan.units.find(unit => unit.id === "unit_motion_A1").payload.description, longDirective);
		assert.equal(receipt.output.unitsCount, saved.plan.units.length);
		assert.equal(receipt.output.planRevision, saved.planRevision);
		assert.equal(saved.plan.accepted, false);
		const details = await bus.run(receipt.output.details.action, receipt.output.details.args);
		assert.equal(details.ok, true, JSON.stringify(details));
		assert.equal(details.output.data.total, saved.plan.units.length);
		assert.deepEqual(details.output.data.units.map(unit => unit.id), saved.plan.units.slice(0, 20).map(unit => unit.id));
	} finally {
		bus.dispose();
		transport.bus.dispose();
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
