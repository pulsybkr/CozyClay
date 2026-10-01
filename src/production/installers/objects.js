import { installSetStructures } from "./index.js";
export async function installSetObjects(plan, sceneId, bus, ports = {}) {
 const unit = plan?.plan?.units?.find(u => u.kind === "structure" && u.payload.sceneId === sceneId);
 if (!unit) throw new Error("Structure unit not found: " + sceneId);
 return installSetStructures(unit, { bus, ...ports });
}
