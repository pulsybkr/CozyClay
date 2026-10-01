import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	SOURCE_SCHEMA_VERSION,
	SOURCE_LIMITS,
	canonicalJson,
	computeCanonicalHash,
	validateManifest,
	validateSectionPage,
	validateSnapshot,
	assertValidSnapshot,
	ValidationError,
} from "../src/production/source-contract.js";

import {
	PLAN_SCHEMA_VERSION,
	validateProductionDocument,
	validateProductionUnit,
	validateSequenceEntry,
	validateEntityBinding,
} from "../src/production/plan-contract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures", "production");

function readFixture(name) {
	const content = fs.readFileSync(path.join(fixturesDir, name), "utf8");
	return JSON.parse(content);
}

test("Canonical JSON: deterministic key ordering and serialization", async () => {
	const objA = { b: 2, a: 1, c: { z: "last", m: "mid", a: "first" } };
	const objB = { c: { a: "first", z: "last", m: "mid" }, a: 1, b: 2 };
	assert.equal(canonicalJson(objA), canonicalJson(objB));
	assert.equal(canonicalJson(objA), '{"a":1,"b":2,"c":{"a":"first","m":"mid","z":"last"}}');

	const hashA = await computeCanonicalHash(objA);
	const hashB = await computeCanonicalHash(objB);
	assert.equal(hashA, hashB);
	assert.match(hashA, /^sha256:[a-f0-9]{64}$/);
});

test("Fixture validation: office-12s.json passes validation", () => {
	const office = readFixture("office-12s.json");
	const res = validateSnapshot(office);
	assert.equal(res.valid, true, `Expected valid snapshot, got errors: ${JSON.stringify(res.errors)}`);
	assert.doesNotThrow(() => assertValidSnapshot(office));
});

test("Fixture validation: story-30s.json passes validation", () => {
	const story = readFixture("story-30s.json");
	const res = validateSnapshot(story);
	assert.equal(res.valid, true, `Expected valid snapshot, got errors: ${JSON.stringify(res.errors)}`);
});

test("Fixture validation: legacy-flow.json passes validation", () => {
	const legacyFlow = readFixture("legacy-flow.json");
	const res = validateSnapshot(legacyFlow);
	assert.equal(res.valid, true, `Expected valid snapshot, got errors: ${JSON.stringify(res.errors)}`);
});

test("Fixture validation: legacy-agnes.json passes validation", () => {
	const legacyAgnes = readFixture("legacy-agnes.json");
	const res = validateSnapshot(legacyAgnes);
	assert.equal(res.valid, true, `Expected valid snapshot, got errors: ${JSON.stringify(res.errors)}`);
});

test("Fixture validation: invalid-source.json fails with precise JSON pointer errors", () => {
	const invalid = readFixture("invalid-source.json");
	const res = validateSnapshot(invalid);
	assert.equal(res.valid, false);

	const paths = res.errors.map(e => e.path);
	assert.ok(paths.includes("/scenes/0/setId"), "Must detect missing set reference");
	assert.ok(paths.includes("/scenes/0/cast/0/characterId"), "Must detect missing cast character reference");
	assert.ok(paths.includes("/shots/0/camera/targets/0"), "Must detect missing target reference in camera");
	assert.ok(paths.includes("/shots/SHOT_02/startSeconds"), "Must detect timing gap between shot 1 and shot 2");

	assert.throws(() => assertValidSnapshot(invalid), ValidationError);
});

test("Manifest validation: happy path and error cases", () => {
	const validManifest = {
		schemaVersion: SOURCE_SCHEMA_VERSION,
		projectId: "proj_123",
		revision: "r01",
		manifestHash: "sha256:" + "a".repeat(64),
		title: "Valid Project",
		sourceMode: "structured",
		project: { fps: 24, aspect: "9:16", durationSeconds: 60 },
		sections: [
			{ name: "characters", count: 2, ids: ["c1", "c2"], hash: "sha256:" + "b".repeat(64) },
			{ name: "sets", count: 1, ids: ["s1"], hash: "sha256:" + "c".repeat(64) },
		],
		resources: [],
		warnings: [],
	};

	assert.equal(validateManifest(validManifest).valid, true);

	// Count mismatch
	const badCount = structuredClone(validManifest);
	badCount.sections[0].count = 5;
	const countRes = validateManifest(badCount);
	assert.equal(countRes.valid, false);
	assert.ok(countRes.errors.some(e => e.code === "COUNT_MISMATCH"));

	// Out of bounds duration (> 1200s)
	const longDuration = structuredClone(validManifest);
	longDuration.project.durationSeconds = 1500;
	const durRes = validateManifest(longDuration);
	assert.equal(durRes.valid, false);
	assert.ok(durRes.errors.some(e => e.code === "OUT_OF_BOUNDS"));

	// Unknown section
	const badSection = structuredClone(validManifest);
	badSection.sections.push({ name: "unknown_zone", count: 0, ids: [] });
	const secRes = validateManifest(badSection);
	assert.equal(secRes.valid, false);
	assert.ok(secRes.errors.some(e => e.code === "UNKNOWN_SECTION"));
});

test("Section page validation: pagination boundaries", () => {
	const validPage = {
		schemaVersion: SOURCE_SCHEMA_VERSION,
		projectId: "proj_123",
		revision: "r01",
		section: "characters",
		sectionHash: "sha256:" + "d".repeat(64),
		items: [{ id: "c1" }, { id: "c2" }],
		nextCursor: null,
		total: 2,
	};

	assert.equal(validateSectionPage(validPage, "characters").valid, true);

	// Section mismatch
	const mismatchRes = validateSectionPage(validPage, "sets");
	assert.equal(mismatchRes.valid, false);
	assert.ok(mismatchRes.errors.some(e => e.code === "SECTION_MISMATCH"));

	// Exceed max page limit (100)
	const bigPage = structuredClone(validPage);
	bigPage.items = Array.from({ length: 105 }, (_, i) => ({ id: `c_${i}` }));
	const bigRes = validateSectionPage(bigPage);
	assert.equal(bigRes.valid, false);
	assert.ok(bigRes.errors.some(e => e.code === "PAGE_TOO_LARGE"));
});

test("Plan contract: ProductionDocument and ProductionUnit validation", () => {
	const validDoc = {
		version: PLAN_SCHEMA_VERSION,
		productionId: "prod-uuid-001",
		source: {
			connectionId: "conn_local",
			projectId: "88LTeGwzPgE",
			revision: "r17",
			manifestHash: "sha256:" + "e".repeat(64),
			fetchedSections: {},
		},
		planRevision: 1,
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
					payload: { name: "Bureau" },
					review: "ready",
				},
				{
					id: "shot:SHOT_01",
					kind: "shot",
					sourceRefs: ["SHOT_01"],
					sceneId: "SCENE_01",
					dependsOn: ["decor:ENV_OFFICE"],
					inputHash: "sha256:" + "2".repeat(64),
					payload: { durationFrames: 96 },
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
				nativeSceneId: "scene_01",
				nativeEntityId: "obj_desk",
				nativeKind: "object",
				installedInputHash: "sha256:" + "1".repeat(64),
			},
		},
		artifacts: {},
		overrides: [],
		executionCheckpoint: {
			savedAt: new Date().toISOString(),
			units: [],
		},
	};

	const docRes = validateProductionDocument(validDoc);
	assert.equal(docRes.valid, true, `Document should be valid: ${JSON.stringify(docRes.errors)}`);

	// Unsupported version
	const badVersion = structuredClone(validDoc);
	badVersion.version = 99;
	assert.equal(validateProductionDocument(badVersion).valid, false);

	// Invalid unit kind
	const badUnit = structuredClone(validDoc);
	badUnit.plan.units[0].kind = "unsupported_kind";
	assert.equal(validateProductionDocument(badUnit).valid, false);
});
