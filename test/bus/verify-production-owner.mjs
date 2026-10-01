import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAppContext } from '../../src/app-context.js';
import { createProductionDomain } from '../../src/domains/production.js';

test('Production owner: creation, initial state and registration in appContext', () => {
	const appContext = createAppContext();
	const production = createProductionDomain(appContext);

	try {
		assert.equal(appContext.storeDomain('production'), production);
		const doc = production.read();
		assert.equal(doc.version, 1);
		assert.equal(doc.planRevision, 0);
		assert.equal(doc.source, null);
		assert.deepEqual(doc.bindings, {});
		assert.equal(typeof production.document, 'function');
		assert.deepEqual(production.document(), { production: doc });
	} finally {
		production.dispose();
	}
});

test('Production owner: writePlan increments planRevision and supports undo/redo', () => {
	const appContext = createAppContext();
	const production = createProductionDomain(appContext);

	try {
		const initialRevision = production.read().planRevision;

		// 1. Transaction that is cancelled
		const cancelSession = production.beginAction();
		cancelSession.run(() => {
			production.writePlan(p => ({ ...p, frameCount: 48 }));
		});
		assert.equal(production.read().plan.frameCount, 48);
		cancelSession.cancel();
		assert.equal(production.read().plan.frameCount, 0, "Cancelled transaction must restore frameCount to 0");
		assert.equal(production.read().planRevision, initialRevision, "Cancelled transaction must restore planRevision");

		// 2. Action committed with history
		const { historyEntryId } = production.recordAction(() => {
			production.writePlan(p => ({ ...p, frameCount: 96 }));
		});
		assert.ok(historyEntryId);
		assert.equal(production.read().plan.frameCount, 96);
		assert.equal(production.read().planRevision, initialRevision + 1);

		// 3. Undo
		assert.equal(production.canUndo(historyEntryId), true);
		assert.equal(production.stepHistory(false), true, "Undo step must succeed");
		assert.equal(production.read().plan.frameCount, 0, "Undo must restore frameCount to 0");

		// 4. Redo
		assert.equal(production.stepHistory(true), true, "Redo step must succeed");
		assert.equal(production.read().plan.frameCount, 96, "Redo must restore frameCount to 96");
	} finally {
		production.dispose();
	}
});

test('Production owner: patchBindings and invalidateBindingsAgainstScene detect missing native entities', () => {
	const appContext = createAppContext();
	const production = createProductionDomain(appContext);

	try {
		// Set checkpoint with installed unit
		production.updateCheckpoint({
			unitId: "decor:ENV_OFFICE",
			state: "done",
			inputHash: "hash-1",
		});

		// Bind unit to native object "desk_01"
		production.patchBindings({
			"decor:ENV_OFFICE": {
				sourceId: "ENV_OFFICE",
				nativeSceneId: "scene-1",
				nativeEntityId: "desk_01",
				nativeKind: "object",
				installedInputHash: "hash-1",
			},
		});

		// 1. Scene contains "desk_01" -> unit remains "installed"
		const goodScene = {
			id: "scene-1",
			stage: {
				objects: [{ id: "desk_01", name: "Desk" }],
				characters: [],
			},
		};
		production.invalidateBindingsAgainstScene(goodScene);
		const checkpoint1 = production.read().executionCheckpoint.units.find(u => u.unitId === "decor:ENV_OFFICE");
		assert.equal(checkpoint1.state, "done");

		// 2. Scene no longer contains "desk_01" (user deleted it) -> unit becomes "stale"
		const badScene = {
			id: "scene-1",
			stage: {
				objects: [], // desk was removed
				characters: [],
			},
		};
		production.invalidateBindingsAgainstScene(badScene);
		const checkpoint2 = production.read().executionCheckpoint.units.find(u => u.unitId === "decor:ENV_OFFICE");
		assert.equal(checkpoint2.state, "stale", "Unit must become stale when bound native entity is missing");
	} finally {
		production.dispose();
	}
});

test('Production owner: portable export/load preserves production state without credentials', () => {
	const appContext = createAppContext();
	const production = createProductionDomain(appContext);

	try {
		production.setSourceSnapshot({
			connectionId: "conn_1",
			projectId: "proj_abc",
			revision: "r01",
			manifestHash: "sha256:" + "0".repeat(64),
			apiKey: "LEAKED_KEY_MUST_BE_STRIPPED",
		});
		production.writePlan(p => ({ ...p, frameCount: 120 }));

		const portable = production.exportPortable();
		assert.equal(portable.source.connectionId, "conn_1");
		assert.equal(portable.source.projectId, "proj_abc");
		assert.equal(portable.source.apiKey, undefined, "exportPortable must strip apiKey");
		assert.equal(portable.plan.frameCount, 120);

		// Load into a fresh domain
		const appContext2 = createAppContext();
		const production2 = createProductionDomain(appContext2);
		try {
			production2.loadPortable(portable);
			assert.equal(production2.read().source.projectId, "proj_abc");
			assert.equal(production2.read().plan.frameCount, 120);
		} finally {
			production2.dispose();
		}
	} finally {
		production.dispose();
	}
});

test('Production domain in document projection does not throw in elementTarget or readElementDocument', async () => {
	const { elementTarget, readElementDocument } = await import('../../src/commands/elements.js');
	const projection = {
		production: { version: 1, plan: { frameCount: 0 } },
	};
	// Must not throw TypeError: Cannot read properties of undefined (reading 'collection')
	assert.doesNotThrow(() => {
		const target = elementTarget('production', projection.production, 'some-id', 'scene-id');
		assert.equal(target, undefined);
	});
	assert.doesNotThrow(() => {
		const read = readElementDocument(projection, {}, 'scene-id');
		assert.deepEqual(read.document, {});
	});
});
