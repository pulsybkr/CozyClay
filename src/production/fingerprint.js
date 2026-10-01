// Deterministic hashing for production unit inputs, entity projections and graph signatures.
// Pure ECMAScript (browser and Node compatible).

import { canonicalJson, computeCanonicalHash } from "./source-contract.js";

/**
 * Computes a deterministic input hash for a ProductionUnit.
 * Any change to kind, payload, sourceRefs, or dependencies changes this hash.
 */
export async function computeUnitInputHash(unit, subtle = globalThis.crypto?.subtle) {
	if (!unit || typeof unit !== "object") {
		throw new Error("Unit must be an object to compute input hash.");
	}
	const canonicalData = {
		kind: unit.kind ?? "",
		sourceRefs: [...(unit.sourceRefs ?? [])].sort(),
		dependsOn: [...(unit.dependsOn ?? [])].sort(),
		payload: unit.payload ?? {},
	};
	return computeCanonicalHash(canonicalData, subtle);
}

/**
 * Computes an observed projection hash of a native scene entity (object, character, shot, camera).
 * Captures physical and structural parameters to detect manual user overrides or deletions.
 */
export async function computeEntityProjectionHash(entity, subtle = globalThis.crypto?.subtle) {
	if (!entity || typeof entity !== "object") {
		return computeCanonicalHash({ empty: true }, subtle);
	}
	// Extract normalized physical attributes
	const projection = {
		id: entity.id ?? "",
		kind: entity.kind ?? (entity.modelId ? "character" : "object"),
		...(entity.position ? {
			position: {
				x: Math.round((entity.position.x ?? 0) * 1000) / 1000,
				y: Math.round((entity.position.y ?? 0) * 1000) / 1000,
				z: Math.round((entity.position.z ?? 0) * 1000) / 1000,
			},
		} : {}),
		...(entity.scale !== undefined ? {
			scale: typeof entity.scale === "object"
				? {
					x: Math.round((entity.scale.x ?? 1) * 1000) / 1000,
					y: Math.round((entity.scale.y ?? 1) * 1000) / 1000,
					z: Math.round((entity.scale.z ?? 1) * 1000) / 1000,
				}
				: Math.round(entity.scale * 1000) / 1000,
		} : {}),
		...(entity.yawDeg !== undefined || entity.yawDegrees !== undefined ? {
			yawDeg: Math.round((entity.yawDeg ?? entity.yawDegrees ?? 0) * 10) / 10,
		} : {}),
	};
	return computeCanonicalHash(projection, subtle);
}

/**
 * Computes a hash of the entire plan graph (all unit IDs, dependencies, and input hashes).
 */
export async function computePlanGraphSignature(units = [], subtle = globalThis.crypto?.subtle) {
	const normalizedUnits = [...units].map(u => ({
		id: u.id,
		kind: u.kind,
		inputHash: u.inputHash,
		dependsOn: [...(u.dependsOn ?? [])].sort(),
	})).sort((a, b) => a.id.localeCompare(b.id));

	return computeCanonicalHash(normalizedUnits, subtle);
}
