import { installSceneEnvironment, installShots } from "./index.js";
export async function installScene(plan, sceneId, bus, ports = {}) {
 const units = plan?.plan?.units;
 const scene = units?.find(u => u.kind === "scene" && u.payload.sceneId === sceneId);
 if (!scene) throw new Error("Scene unit not found: " + sceneId);
 const result = await installSceneEnvironment(scene, { bus, ...ports });
 const context = { bus, ...ports, bindings: { ...ports.bindings, ...result.bindings } };
 const shots = await installShots(units.filter(u => u.kind === "shot" && u.payload.sceneId === sceneId), context);
 return { ...result, bindings: { ...result.bindings, ...shots.bindings } };
}
