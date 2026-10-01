#!/usr/bin/env node
/**
 * Test suite for production installers and native entity bindings (Lot 5).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "../src/production/compiler.js";
import { installScene } from "../src/production/installers/scene.js";
import { installSetObjects } from "../src/production/installers/objects.js";
import { declarations as shotDeclarations, register as registerShotCommands } from "../src/commands/shot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures", "production");

function readJsonFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8"));
}

function mockBus() {
 const log = []; let serial = 0;
 return { log, run: async (id, args) => {
  log.push({ id, args });
  if (id === "scene.create") { assert.deepEqual(args, {}); return { affectedIds: ["real_scene"] }; }
  if (id === "object.add") { assert.notEqual(args.kind, "box"); return { affectedIds: ["obj_" + ++serial] }; }
  if (id === "camera.create") return { affectedIds: [args.cameraId] };
  if (id === "asset.searchLibrary") return { output: { models: [{ id: "model1", title: "Model", usable: true, heavy: false, license: "CC0", downloadUrl: "https://example.invalid/model.glb" }] } };
  if (id === "asset.downloadLibraryModel") return { affectedIds: ["mesh_" + ++serial] };
  assert.ok(["scene.rename", "scene.switch", "shot.setTimeline", "camera.set", "shot.upsert", "object.update"].includes(id), "Unexpected command " + id);
  return { affectedIds: [] };
 } };
}

test("Installers: installScene configures scene, timeline, cameras and shots", async () => {
	const snapshot = readJsonFixture("office-12s.json");
	const { plan } = compile(snapshot);
	assert.ok(plan, "compilation must succeed");

	const bus = mockBus();
	const result = await installScene(plan, "SCENE_01", bus);

	assert.ok(result.bindings["SCENE_01"], "scene binding must exist");
	assert.equal(result.bindings["SCENE_01"].nativeKind, "scene");

	// Check commands invoked on the bus
	const timelineCall = bus.log.find((c) => c.id === "shot.setTimeline");
	assert.ok(timelineCall, "timeline must be configured");
	assert.equal(timelineCall.args.frameCount, 288);

	const shotUpsertCalls = bus.log.filter((c) => c.id === "shot.upsert");
	assert.equal(shotUpsertCalls.length, 3, "all 3 shots must be upserted");
	assert.equal(shotUpsertCalls[0].args.shotId, "SHOT_01");
	assert.equal(shotUpsertCalls[0].args.startFrame, 0);
	assert.equal(shotUpsertCalls[0].args.endFrameExclusive, 96);

	// Check bindings for shots and cameras
	assert.ok(result.bindings["SCENE_01:SHOT_01"], "SHOT_01 binding must exist");
	assert.equal(result.bindings["SCENE_01:SHOT_01"].nativeKind, "shot");
	assert.ok(result.bindings["SCENE_01:cam_SHOT_01"], "cam_SHOT_01 binding must exist");
	assert.equal(result.bindings["SCENE_01:cam_SHOT_01"].nativeKind, "camera");
});

test("Installers: installSetObjects places props with support surface height", async () => {
	const snapshot = readJsonFixture("office-12s.json");
	const { plan } = compile(snapshot);
	assert.ok(plan, "compilation must succeed");

	const bus = mockBus();
	const result = await installSetObjects(plan, "SCENE_01", bus, { bindings: { SCENE_01: { nativeEntityId: "real_scene" } } });

	assert.ok(result.bindings["SCENE_01:DESK"], "DESK binding must exist");
	assert.ok(result.bindings["SCENE_01:CUP"], "CUP binding must exist");

	const deskInstall = result.installedObjects.find((o) => o.sourceId === "DESK");
	const cupInstall = result.installedObjects.find((o) => o.sourceId === "CUP");

	assert.equal(deskInstall.placement.y, 0, "desk stands on ground");
	assert.equal(cupInstall.placement.y, 0.75, "cup rests at desk top height (y=0.75)");
});

test("Shot commands: shot.upsert creates and sorts shots deterministically", async () => {
	let documentShots = [];
	const owner = {
		read: () => documentShots,
		write: (fn) => {
			documentShots = typeof fn === "function" ? fn(documentShots) : fn;
		},
		state: () => ({ frameCount: 288 }),
		cameraContext: () => ({ characters: [], filmback: {} }),
	};

	const entries = new Map();
	const registry = {
		register: (d) => entries.set(d.id, d),
		registerElementSet: () => {},
		registerToolAlias: () => {},
	};

	const ports = {
		storeDomain: (name) => (name === "shot" ? owner : null),
		state: () => ({ activeSceneId: "scene_1" }),
	};

	registerShotCommands(registry, ports);

	const upsertCommand = entries.get("shot.upsert");
	assert.ok(upsertCommand, "shot.upsert must be registered in command registry");

	// Upsert shot 2 first, then shot 1: must be sorted by startFrame
	await upsertCommand.run({
		shotId: "SHOT_02",
		startFrame: 96,
		endFrameExclusive: 192,
		name: "Shot 2",
		cameraId: "cam_2",
	});

	await upsertCommand.run({
		shotId: "SHOT_01",
		startFrame: 0,
		endFrameExclusive: 96,
		name: "Shot 1",
		cameraId: "cam_1",
	});

	assert.equal(documentShots.length, 2);
	assert.equal(documentShots[0].id, "SHOT_01");
	assert.equal(documentShots[0].startFrame, 0);
	assert.equal(documentShots[0].endFrame, 95);
	assert.equal(documentShots[1].id, "SHOT_02");
	assert.equal(documentShots[1].startFrame, 96);
	assert.equal(documentShots[1].endFrame, 191);
});
