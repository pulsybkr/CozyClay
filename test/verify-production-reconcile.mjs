import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcile } from "../src/production/reconcile.js";

test("Reconcile: detects all units needing execution when checkpoint is empty", () => {
	const plan = {
		units: [
			{ id: "unit-1", stage: "avatar", dependsOn: [] },
			{ id: "unit-2", stage: "clip", dependsOn: ["unit-1"] },
		],
	};
	const checkpoint = { units: [] };

	const report = reconcile({ plan, checkpoint });
	assert.equal(report.reconciledCount, 0);
	assert.equal(report.counts.ready, 1);
	assert.equal(report.counts.blocked, 1);
	assert.deepEqual(report.resumeCandidates, ["unit-1"]);
});

test("Reconcile: identifies completed units and filters out from resumeCandidates", () => {
	const plan = {
		units: [
			{ id: "unit-1", stage: "avatar", inputHash: "hash-1", dependsOn: [] },
			{ id: "unit-2", stage: "clip", inputHash: "hash-2", dependsOn: ["unit-1"] },
		],
	};
	const checkpoint = {
		units: [
			{ unitId: "unit-1", inputHash: "hash-1", state: "done" },
		],
	};

	const report = reconcile({ plan, checkpoint });
	assert.equal(report.reconciledCount, 1);
	assert.deepEqual(report.resumeCandidates, ["unit-2"]);
});

test("Reconcile: flags missing native entity bindings as stale and candidates for recovery", () => {
	const plan = {
		units: [
			{ id: "unit-1", stage: "avatar", inputHash: "hash-1", sourceRefs: ["char-A"] },
		],
	};
	const checkpoint = {
		units: [
			{ unitId: "unit-1", inputHash: "hash-1", state: "done" },
		],
	};
	const bindings = {
		"char-A": { nativeKind: "character", nativeEntityId: "char-native-99" },
	};
	// Scene has NO characters (nativeEntityId missing)
	const nativeScene = {
		stage: { characters: [] },
	};

	const report = reconcile({ plan, checkpoint, bindings, nativeScene });
	assert.equal(report.staleCount, 1);
	assert.equal(report.units["unit-1"].status, "stale");
	assert.ok(report.resumeCandidates.includes("unit-1"));
});
