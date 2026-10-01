import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/production/compiler.js";
import { createProductionController } from "../src/production/controller.js";
import { createAppContext } from "../src/app-context.js";
import { createProductionDomain } from "../src/domains/production.js";
import { createStudioAppActions, commandDeclarations } from "../src/commands/index.js";
import { validateStudioSchema } from "../src/studio-agent-protocol.js";
import { createSceneObject, updateSceneObject, objectSize } from "../src/scene-objects.js";
import { createCharacterEntry } from "../src/scenes.js";
import { installSceneEnvironment, installSetStructures, installCastInstance, installShots } from "../src/production/installers/index.js";
import { produceAvatar } from "../src/production/avatar-producer.js";
import { fetchValidatedSection } from "../src/production/source-client.js";
import { computeSectionHash } from "../src/production/source-contract.js";
const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/production/office-12s.json", import.meta.url)));
function nativeBus() {
 const schemas = new Map(commandDeclarations().map(d => [d.id, d.input])), log = [], objects = [];
 return { log, objects, run: async (id, args) => {
  assert.ok(schemas.has(id)); validateStudioSchema(schemas.get(id), args); log.push({ id, args });
  if (id === "scene.create") return { affectedIds: ["realScene"] };
  if (id === "object.add") { const o = createSceneObject(args.kind, objects, args.placement); objects.push(o); return { affectedIds: [o.id] }; }
  if (id === "object.update") objects.splice(0, objects.length, ...updateSceneObject(objects, args.id, args.patch));
  if (id === "character.add") { const c = createCharacterEntry(args.character); return { affectedIds: [c.id], output: c }; }
  if (id === "camera.create") return { affectedIds: [args.cameraId] };
  return { affectedIds: [] };
 } };
}
function setup() { const app = createAppContext(); return { app, domain: createProductionDomain(app) }; }
test("Native installation validates real schemas, wall dimensions, actors and moving cameras", async () => {
 const doc = compile(fixture()).plan, bus = nativeBus();
 const scene = await installSceneEnvironment(doc.plan.units.find(u => u.kind === "scene"), { bus });
 const structure = doc.plan.units.find(u => u.kind === "structure");
 await installSetStructures({ ...structure, payload: { ...structure.payload, props: [] } }, { bus, bindings: scene.bindings });
 assert.deepEqual(objectSize(bus.objects[0]), { width: 4, height: 2.8, depth: 0.12 });
 const sourceAvatar = doc.plan.units.find(u => u.kind === "avatar");
 const avatar = await produceAvatar({ ...sourceAvatar, payload: { ...sourceAvatar.payload, strategy: "builtin" } });
 await installCastInstance(doc.plan.units.find(u => u.kind === "cast-instance"), { bus, bindings: scene.bindings, avatar });
 const c = bus.log.find(row => row.id === "character.add").args.character;
 assert.equal(c.x, -1); assert.equal(c.z, 1); assert.equal(c.model, avatar.modelId);
 await installShots(doc.plan.units.filter(u => u.kind === "shot"), { bus, bindings: scene.bindings });
 assert.equal(bus.log.find(row => row.id === "camera.set").args.set.cameraKeys.length, 2);
});
test("Compilation retains contact, gestures, expressions and typed overrides without mutating source", () => {
 const source = fixture(), before = JSON.stringify(source);
 const units = compile(source, [{ op: "set-prop-height", sourceId: "DESK", heightMeters: 0.9 }]).plan.plan.units;
 assert.equal(units.find(u => u.id === "unit_interaction_ACT_PICKUP").payload.contactFrame, 240);
 assert.equal(units.find(u => u.id === "unit_interaction_ACT_PICKUP").payload.releaseFrame, null);
 for (const [id, kind] of [["ACT_A_WALK", "walk"], ["ACT_A_WAVE", "wave"], ["ACT_B_REPLY", "nod"]]) assert.equal(units.find(u => u.id === "unit_motion_" + id).payload.motionKind, kind);
 assert.ok(units.some(u => u.kind === "expressions"));
 assert.equal(units.find(u => u.kind === "structure").payload.props.find(p => p.id === "DESK").height, 0.9);
 assert.equal(JSON.stringify(source), before);
 assert.equal(compile(source, [{ op: "choose-resource", sourceId: "missing" }]).plan, null);
});
test("Duplicate execution is cached and failed attempts survive controller hydration", async () => {
 const { domain } = setup(), bus = nativeBus();
 const unit = { id: "s", kind: "scene", inputHash: "h", dependsOn: [], payload: { sceneId: "S", name: "S", durationFrames: 48 } };
 domain.writePlan({ units: [unit] });
 const ctrl = createProductionController({ productionDomain: domain, bus });
 await Promise.all([ctrl.executeUnit(unit), ctrl.executeUnit(unit)]); await ctrl.executeUnit(unit);
 assert.equal(bus.log.filter(row => row.id === "scene.create").length, 1);
 await assert.rejects(ctrl.executeUnit({ ...unit, id: "bad", kind: "interaction" }));
 const hydrated = createProductionController({ productionDomain: domain, bus });
 assert.equal(hydrated.runStore.getUnitState("bad").state, "failed");
 assert.ok(domain.read().executionCheckpoint.events.length); domain.dispose();
});
test("Unsupported motion and generated avatar cannot silently become done", async () => {
 const { domain } = setup(), ctrl = createProductionController({ productionDomain: domain });
 await assert.rejects(ctrl.executeUnit({ id: "m", kind: "motion-clip", inputHash: "h", dependsOn: [], payload: {} }), { code: "PRODUCER_NOT_CONFIGURED" });
 assert.equal(ctrl.runStore.getUnitState("m").state, "failed");
 await assert.rejects(produceAvatar({ id: "a", payload: { characterId: "A", strategy: "generate" } }), { code: "PRODUCER_NOT_CONFIGURED" }); domain.dispose();
});
test("Verification and export reject failed checkpoints", async () => {
 const { app, domain } = setup();
 const registry = createStudioAppActions({ ...app.actionPorts, state: () => ({}), storeDomain: n => app.storeDomain(n) });
 const id = domain.read().productionId;
 domain.writePlan({ units: [{ id: "u", kind: "interaction", inputHash: "h", dependsOn: [], payload: {} }] });
 domain.updateCheckpoint({ unitId: "u", inputHash: "h", state: "failed" });
 assert.equal((await registry.run("production.verify", { productionId: id, scopeIds: [] })).output.verified, false);
 await assert.rejects(registry.run("production.export", { productionId: id, expectedPlanRevision: domain.read().planRevision }), { code: "EXPORT_NOT_VERIFIED" }); domain.dispose();
});
test("Export calls encoder and returns its actual file proof", async () => {
 const { app, domain } = setup(), calls = [];
 domain.writePlan({ units: [{ id: "s", kind: "scene", inputHash: "h", dependsOn: [], payload: { sceneId: "S" } }], frameCount: 48 });
 domain.updateCheckpoint({ unitId: "s", inputHash: "h", state: "done" });
 domain.patchBindings({ S: { unitId: "s", nativeEntityId: "realScene", nativeKind: "scene" } });
 const bus = { run: async id => { calls.push(id); return id === "export.shotVideo" ? { output: { fileName: "actual.mp4", frameCount: 48 } } : { affectedIds: [] }; } };
 const registry = createStudioAppActions({ ...app.actionPorts, bus, state: () => ({ scenes: [{ id: "realScene" }] }), storeDomain: n => app.storeDomain(n) });
 const result = await registry.run("production.export", { productionId: domain.read().productionId, expectedPlanRevision: domain.read().planRevision });
 assert.deepEqual(calls, ["scene.switch", "export.shotVideo"]); assert.equal(result.output.fileName, "actual.mp4"); domain.dispose();
});
test("Pinned pages reject different revisions, count mismatch and hash corruption", async () => {
 const previous = globalThis.fetch, items = [{ id: "A", name: "A" }];
 const manifest = { revision: "r1", sections: [{ name: "characters", count: 1, ids: ["A"], hash: await computeSectionHash("characters", items) }] };
 const good = { schemaVersion: "cozy-story-v1", projectId: "p", revision: "r1", section: "characters", items, total: 1, nextCursor: null };
 try {
  globalThis.fetch = async () => new Response(JSON.stringify(good));
  assert.deepEqual(await fetchValidatedSection("c", "p", manifest, "characters"), items);
  for (const [patch, code] of [[{ revision: "r2" }, "REVISION_MISMATCH"], [{ items: [] }, "COUNT_MISMATCH"], [{ items: [{ id: "A", name: "altered" }] }, "HASH_MISMATCH"]]) {
   globalThis.fetch = async () => new Response(JSON.stringify({ ...good, ...patch }));
   await assert.rejects(fetchValidatedSection("c", "p", manifest, "characters"), { code });
  }
 } finally { globalThis.fetch = previous; }
});
test("Pagination loads all pages and rejects cursor loops", async () => {
 const previous = globalThis.fetch, manifest = { revision: "r1", sections: [{ name: "characters", count: 2 }] };
 const base = { schemaVersion: "cozy-story-v1", projectId: "p", revision: "r1", section: "characters", total: 2 };
 try {
  globalThis.fetch = async url => new Response(JSON.stringify({ ...base, items: [{ id: String(url.includes("cursor=")) }], nextCursor: url.includes("cursor=") ? null : "next" }));
  assert.equal((await fetchValidatedSection("c", "p", manifest, "characters")).length, 2);
  globalThis.fetch = async () => new Response(JSON.stringify({ ...base, items: [{ id: "A" }], nextCursor: "loop" }));
  await assert.rejects(fetchValidatedSection("c", "p", manifest, "characters"), { code: "CURSOR_LOOP" });
 } finally { globalThis.fetch = previous; }
});

test("Partial scene installation retry reuses the already-created native scene", async () => {
 const { domain } = setup(); let creates = 0, failRename = true;
 const unit = { id: "s", kind: "scene", inputHash: "h", dependsOn: [], payload: { sceneId: "S", name: "S", durationFrames: 48 } };
 domain.writePlan({ units: [unit] });
 const bus = { run: async id => {
  if (id === "scene.create") { creates++; return { affectedIds: ["createdScene"] }; }
  if (id === "scene.rename" && failRename) throw new Error("rename failed");
  return { affectedIds: [] };
 } };
 const ctrl = createProductionController({ productionDomain: domain, bus });
 await assert.rejects(ctrl.executeUnit(unit)); failRename = false; await ctrl.retryUnit(unit.id);
 assert.equal(creates, 1); assert.equal(ctrl.runStore.getUnitState(unit.id).state, "done"); domain.dispose();
});
test("Production session restores only into its matching local scene document", () => {
 const previous = globalThis.localStorage, cache = new Map();
 globalThis.localStorage = { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value) };
 try {
  function appFor(sceneId) {
   const app = createAppContext(); app.shared = { startup: { document: { scenes: [{ id: sceneId }] } } };
   app.registerStoreDomain("scenes", { read: () => [{ id: sceneId }] }); return app;
  }
  const domain = createProductionDomain(appFor("sceneA")); domain.setSourceSnapshot({ projectId: "p", revision: "r1" }); domain.writePlan({ units: [], fps: 24, aspect: "9:16", frameCount: 48, sequence: [] });
  const id = domain.read().productionId; domain.dispose();
  const restored = createProductionDomain(appFor("sceneA")); assert.equal(restored.read().productionId, id); assert.equal(restored.read().plan.frameCount, 48); restored.dispose();
  const other = createProductionDomain(appFor("sceneB")); assert.notEqual(other.read().productionId, id); other.dispose();
 } finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; }
});
