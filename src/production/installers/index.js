/** Native production installation. Never manufacture IDs or swallow bus errors. */
import { objectLibraryEntry } from "../../scene-objects.js";
import { isCharacterModel } from "../../character-models.js";
import { DEFAULT_LIBRARY_LIMIT } from "../../asset-library.js";
export { installScene } from "./scene.js";
export { installSetObjects } from "./objects.js";

export async function runNative(bus, command, args) {
 if (!bus?.run) throw new Error("Native command bus is required.");
 const result = await bus.run(command, args);
 if (!result || result.ok === false || result.status === "error") {
  throw new Error(result?.message || result?.error?.message || result?.error || command + " failed.");
 }
 return result;
}
function createdId(result, command) {
 const id = result.affectedIds?.[0];
 if (!id) throw new Error(command + " did not return a native entity ID.");
 return id;
}
function binding(unit, sourceId, nativeEntityId, nativeKind, nativeSceneId) {
 return { sourceId, unitId: unit.id, nativeEntityId, nativeKind, nativeSceneId, installedInputHash: unit.inputHash };
}
function key(sceneId, sourceId) { return sceneId + ":" + sourceId; }
async function selectScene(unit, { bus, bindings = {} }) {
 const sourceSceneId = unit.payload?.sceneId;
 const nativeSceneId = bindings[sourceSceneId]?.nativeEntityId;
 if (!nativeSceneId) throw new Error("Missing native scene binding for " + sourceSceneId);
 await runNative(bus, "scene.switch", { sceneId: nativeSceneId });
 return nativeSceneId;
}
export async function installSceneEnvironment(unit, { bus, bindings = {}, onBinding } = {}) {
 const sceneId = unit.payload?.sceneId;
 const existing = bindings[sceneId];
 const nativeEntityId = existing?.nativeEntityId || createdId(await runNative(bus, "scene.create", {}), "scene.create");
 onBinding?.({ [sceneId]: binding(unit, sceneId, nativeEntityId, "scene", nativeEntityId) });
 await runNative(bus, "scene.rename", { sceneId: nativeEntityId, name: unit.payload?.name || sceneId });
 await runNative(bus, "scene.switch", { sceneId: nativeEntityId });
 await runNative(bus, "shot.setTimeline", { frameCount: unit.payload.durationFrames });
 return { ok: true, nativeEntityId, installedSceneId: nativeEntityId,
  bindings: { [sceneId]: binding(unit, sceneId, nativeEntityId, "scene", nativeEntityId) } };
}
export async function installSetStructures(unit, context = {}) {
 const { bus, bindings = {}, onBinding } = context;
 const nativeSceneId = await selectScene(unit, context);
 const installed = [], nextBindings = {};
 const sourceSceneId = unit.payload.sceneId;
 for (const prop of [...(unit.payload.structure || []), ...(unit.payload.props || [])]) {
  const bindingKey = key(sourceSceneId, prop.id);
  if (prop.acquisition?.strategy === "library") {
   let id = bindings[bindingKey]?.nativeEntityId;
   const position = prop.position || prop;
   if (!id) {
    const found = await runNative(bus, "asset.searchLibrary", { query: prop.acquisition.query || prop.name, limit: DEFAULT_LIBRARY_LIMIT });
    if (found.output?.reason) throw new Error("Library unavailable for " + (prop.name || prop.id) + ": " + found.output.reason);
    const model = found.output?.models?.find(m => m.usable && !m.heavy && m.downloadUrl && (!prop.acquisition.modelId || m.id === prop.acquisition.modelId));
    if (!model) throw new Error("No usable library model for " + prop.id + "; choose a resource or a procedural object explicitly.");
    const args = { id: model.id, title: model.title, license: model.license, downloadUrl: model.downloadUrl,
     name: prop.name || prop.id, height: prop.height || 1, x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0, rot: prop.rot ?? 0 };
    for (const field of ["sourceUrl", "creator", "attribution", "triCount", "heightHint"]) if (model[field] != null) args[field] = model[field];
    id = createdId(await runNative(bus, "asset.downloadLibraryModel", args), "asset.downloadLibraryModel");
    const bound = binding(unit, prop.id, id, "object", nativeSceneId);
    nextBindings[bindingKey] = bound;
    onBinding?.({ [bindingKey]: bound });
   }
   await runNative(bus, "object.update", { id, patch: { x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0, rot: prop.rot ?? 0, height: prop.height || 1 } });
   nextBindings[bindingKey] = binding(unit, prop.id, id, "object", nativeSceneId);
   installed.push({ id, sourceId: prop.id, placement: { x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0 }, height: prop.height });
   continue;
  }
  const requestedKind = prop.kind || "cube";
  const kind = ["box", "wall", "floor", "ceiling"].includes(requestedKind) ? "cube" : requestedKind;
  const base = objectLibraryEntry(kind);
  if (!base) throw new Error("Unsupported native object kind: " + requestedKind);
  const position = prop.position || prop;
  const placement = { x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0, rot: prop.rot ?? 0 };
  const dimensions = prop.dimensions || {};
  const width = dimensions.x ?? dimensions.width ?? prop.footprint?.width ?? base.footprint.width;
  const height = dimensions.y ?? dimensions.height ?? prop.height ?? base.height;
  const depth = dimensions.z ?? dimensions.depth ?? prop.footprint?.depth ?? base.footprint.depth;
  const id = bindings[bindingKey]?.nativeEntityId || createdId(await runNative(bus, "object.add", {
   kind, name: prop.name || prop.id, placement
  }), "object.add");
  const bound = binding(unit, prop.id, id, "object", nativeSceneId);
  nextBindings[bindingKey] = bound;
  // Persist creation before sizing, so a retry updates rather than duplicates it.
  onBinding?.({ [bindingKey]: bound });
  await runNative(bus, "object.update", { id, patch: { ...placement,
   scaleX: width / base.footprint.width, scaleY: base.height ? height / base.height : 1,
   scaleZ: depth / base.footprint.depth, ...(prop.color ? { color: prop.color } : {}) } });
  installed.push({ id, sourceId: prop.id, placement, height });
 }
 return { ok: true, bindings: nextBindings, installedCount: installed.length,
  installedIds: installed.map(p => p.id), installedObjects: installed };
}
export async function installShots(units, context = {}) {
 const { bus, bindings = {}, onBinding } = context;
 const nextBindings = {}, installed = [];
 for (const unit of Array.isArray(units) ? units : [units]) {
  const nativeSceneId = await selectScene(unit, context);
  const shot = unit.payload, cameraId = shot.cameraId;
  const cameraKey = key(shot.sceneId, cameraId);
  if (!bindings[cameraKey] && !nextBindings[cameraKey]) {
   const id = createdId(await runNative(bus, "camera.create", { cameraId, name: shot.cameraName || "Camera " + shot.shotId }), "camera.create");
   const bound = binding(unit, cameraId, id, "camera", nativeSceneId);
   nextBindings[cameraKey] = bound;
   onBinding?.({ [cameraKey]: bound });
  }
  const nativeCameraId = bindings[cameraKey]?.nativeEntityId || nextBindings[cameraKey].nativeEntityId;
  await runNative(bus, "camera.set", { cameraId: nativeCameraId,
   set: { mode: "keys", interpolation: shot.cameraInterpolation || "smooth", cameraKeys: shot.cameraKeys || [{ frame: 0, framing: { pos: { ...shot.framing.pos }, yaw: shot.framing.yaw, pitch: shot.framing.pitch, fovDeg: shot.framing.fovDeg } }] } });
  await runNative(bus, "shot.upsert", { shotId: shot.shotId, cameraId: nativeCameraId,
   name: "Shot " + shot.shotId, startFrame: shot.startFrame, endFrameExclusive: shot.endFrameExclusive,
   cameraOffsetFrame: shot.cameraOffsetFrame || 0 });
  nextBindings[key(shot.sceneId, shot.shotId)] = binding(unit, shot.shotId, shot.shotId, "shot", nativeSceneId);
  installed.push(shot.shotId);
 }
 return { ok: true, bindings: nextBindings, installedIds: installed, shotCount: installed.length };
}
export async function installCastInstance(unit, context = {}) {
 const { bus, bindings = {}, avatar } = context;
 const nativeSceneId = await selectScene(unit, context);
 const p = unit.payload, bindingKey = key(p.sceneId, p.characterId);
 if (!isCharacterModel(avatar?.modelId)) throw new Error("Avatar has no installed native model for " + p.characterId);
 const character = { name: p.name || p.characterId, model: avatar.modelId,
  x: p.position.x, y: p.position.y, z: p.position.z, rot: p.yawDeg,
  scale: p.height / (avatar.nativeHeightMeters || avatar.heightMeters) };
 const existing = bindings[bindingKey];
 let nativeEntityId;
 if (existing) {
  nativeEntityId = existing.nativeEntityId;
  await runNative(bus, "character.update", { characterId: nativeEntityId, patch: character });
 } else {
  nativeEntityId = createdId(await runNative(bus, "character.add", { character }), "character.add");
 }
 return { ok: true, nativeEntityId, bindings: { [bindingKey]: binding(unit, p.characterId, nativeEntityId, "character", nativeSceneId) } };
}
