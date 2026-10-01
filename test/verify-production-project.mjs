import test from "node:test";
import assert from "node:assert/strict";

import {
	PROJECT_VERSION,
	createProjectDocument,
	readProjectDocument,
} from "../src/project.js";

import { PLAN_SCHEMA_VERSION } from "../src/production/plan-contract.js";
import { referencedProductionAssetIds, sanitizeProductionForExport } from "../src/production/resources.js";

test("Project v4 to v5 migration: opens older files cleanly with production: null", () => {
	// A valid v4 project JSON
	const v4Project = {
		app: "cozyclay",
		kind: "project",
		version: 4,
		name: "Legacy V4 Project",
		scenes: {
			version: 4,
			activeSceneId: "scene-1",
			scenes: [
				{
					id: "scene-1",
					name: "Scene 1",
					stage: { characters: [], objects: [] },
				},
			],
		},
		workspace: null,
		poseLibrary: [],
		workflow: { version: 1, nodes: [], edges: [] },
		resources: { assets: [], motions: [] },
	};

	const readRes = readProjectDocument(JSON.stringify(v4Project));
	assert.equal(readRes.ok, true);
	assert.equal(readRes.project.production, null);
	assert.equal(readRes.project.name, "Legacy V4 Project");
});

test("Project v5 roundtrip: preserves production document, bindings, and uninstalled resources", () => {
	const productionDoc = {
		version: PLAN_SCHEMA_VERSION,
		productionId: "prod-test-uuid-42",
		source: {
			connectionId: "conn_test",
			projectId: "88LTeGwzPgE",
			revision: "r17",
			manifestHash: "sha256:" + "f".repeat(64),
			fetchedSections: {},
		},
		planRevision: 2,
		plan: {
			fps: 24,
			aspect: "9:16",
			frameCount: 288,
			units: [
				{
					id: "decor:ENV_OFFICE",
					kind: "structure",
					sourceRefs: ["ENV_OFFICE"],
					sceneId: null,
					dependsOn: [],
					inputHash: "sha256:" + "1".repeat(64),
					payload: { name: "Bureau", meshAssetId: "mesh-asset-1234567890abcdef12345678" },
					review: "ready",
				},
				{
					id: "avatar:CHAR_A",
					kind: "avatar",
					sourceRefs: ["CHAR_A"],
					sceneId: null,
					dependsOn: [],
					inputHash: "sha256:" + "2".repeat(64),
					payload: { name: "Alex", avatarResourceId: "vrm-mesh-abcdef1234567890abcdef12345678" },
					review: "ready",
				},
			],
			sequence: [
				{
					shotId: "SHOT_01",
					sceneId: "SCENE_01",
					globalStartFrame: 0,
					globalEndFrameExclusive: 96,
					sceneStartFrame: 0,
					nativeShotId: null,
				},
			],
			events: [],
			decisions: [],
		},
		bindings: {
			ENV_OFFICE: {
				sourceId: "ENV_OFFICE",
				nativeSceneId: "scene-1",
				nativeEntityId: "obj_desk",
				nativeKind: "object",
				installedInputHash: "sha256:" + "1".repeat(64),
			},
		},
		artifacts: {
			"art-01": {
				kind: "mesh",
				resourceId: "mesh-asset-9999999999abcdef12345678",
				provider: "poly-pizza",
				externalJobId: null,
			},
		},
		overrides: [],
		executionCheckpoint: {
			savedAt: new Date().toISOString(),
			units: [
				{ unitId: "decor:ENV_OFFICE", status: "installed" },
			],
		},
	};

	const scenesDocument = {
		version: 4,
		activeSceneId: "scene-1",
		scenes: [{ id: "scene-1", name: "Scene 1", stage: { characters: [], objects: [] } }],
	};

	// Create project v5 document
	const projectDoc = createProjectDocument({
		scenesDocument,
		workspaceLayout: null,
		customPoses: [],
		name: "Studio Production Project",
		assets: [],
		motions: [],
		workflow: null,
		production: productionDoc,
	});

	assert.equal(projectDoc.version, 5);
	assert.deepEqual(projectDoc.production, productionDoc);

	// Collect referenced assets from production
	const refIds = referencedProductionAssetIds(productionDoc);
	assert.ok(refIds.has("mesh-asset-1234567890abcdef12345678"), "Must collect unit mesh asset");
	assert.ok(refIds.has("vrm-mesh-abcdef1234567890abcdef12345678"), "Must collect unit avatar asset");
	assert.ok(refIds.has("mesh-asset-9999999999abcdef12345678"), "Must collect artifact asset");

	// Serialize and deserialize
	const serialized = JSON.stringify(projectDoc);
	const readRes = readProjectDocument(serialized);
	assert.equal(readRes.ok, true);
	assert.equal(readRes.project.production.productionId, "prod-test-uuid-42");
	assert.equal(readRes.project.production.plan.units.length, 2);
	assert.equal(readRes.project.production.bindings.ENV_OFFICE.nativeEntityId, "obj_desk");
	assert.equal(readRes.project.production.artifacts["art-01"].provider, "poly-pizza");
});

test("Security: no credentials or secrets are exported into portable production documents", () => {
	const sensitiveDoc = {
		version: 1,
		productionId: "prod-secret",
		source: {
			connectionId: "conn_1",
			projectId: "proj_secret",
			revision: "r1",
			apiKey: "SUPER_SECRET_KEY_NEVER_EXPORT",
			token: "BEARER_TOKEN_NEVER_EXPORT",
			authorization: "Bearer secret",
		},
	};

	const sanitized = sanitizeProductionForExport(sensitiveDoc);
	assert.equal(sanitized.source.connectionId, "conn_1");
	assert.equal(sanitized.source.projectId, "proj_secret");
	assert.equal(sanitized.source.apiKey, undefined);
	assert.equal(sanitized.source.token, undefined);
	assert.equal(sanitized.source.authorization, undefined);
});
