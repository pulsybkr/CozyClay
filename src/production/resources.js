// Resource collection and reference deduplication for CozyClay Production.
// Pure ECMAScript (browser and Node compatible).

import { isAssetId } from "../scene-assets.js";

/**
 * Collects all asset and mesh IDs referenced by a ProductionDocument,
 * including artifacts, unit payloads, and entity bindings, so they can be
 * bundled into the project file or verified for availability.
 *
 * @param {object|null} production - The ProductionDocument or portable production state
 * @returns {Set<string>} - Set of referenced asset IDs (e.g. "asset-...", "vrm-mesh-...", etc.)
 */
export function referencedProductionAssetIds(production) {
	const ids = new Set();
	if (!production || typeof production !== "object") return ids;

	// 1. Artifact references
	if (production.artifacts && typeof production.artifacts === "object") {
		for (const artifact of Object.values(production.artifacts)) {
			if (artifact?.resourceId && typeof artifact.resourceId === "string") {
				ids.add(artifact.resourceId);
			}
		}
	}

	// 2. Units payloads
	const units = production.plan?.units;
	if (Array.isArray(units)) {
		for (const unit of units) {
			const payload = unit?.payload;
			if (!payload || typeof payload !== "object") continue;

			// Avatar mesh / VRM resources
			if (payload.avatarResourceId && typeof payload.avatarResourceId === "string") {
				ids.add(payload.avatarResourceId);
			}
			if (payload.modelId && typeof payload.modelId === "string" && isAssetId(payload.modelId)) {
				ids.add(payload.modelId);
			}

			// Prop mesh resources
			if (payload.meshAssetId && typeof payload.meshAssetId === "string") {
				ids.add(payload.meshAssetId);
			}
			if (payload.assetId && typeof payload.assetId === "string") {
				ids.add(payload.assetId);
			}
		}
	}

	// 3. Bindings
	if (production.bindings && typeof production.bindings === "object") {
		for (const binding of Object.values(production.bindings)) {
			if (binding?.nativeKind === "object" || binding?.nativeKind === "character") {
				if (binding.nativeEntityId && isAssetId(binding.nativeEntityId)) {
					ids.add(binding.nativeEntityId);
				}
			}
		}
	}

	return ids;
}

/**
 * Validates that an artifact reference has valid kind, resourceId, and metadata.
 */
export function isValidArtifactRef(artifact) {
	if (!artifact || typeof artifact !== "object") return false;
	if (!["vrm", "mesh", "motion"].includes(artifact.kind)) return false;
	if (typeof artifact.resourceId !== "string" || !artifact.resourceId.trim()) return false;
	if (typeof artifact.provider !== "string" || !artifact.provider.trim()) return false;
	return true;
}

/**
 * Strips any sensitive credentials, auth headers or local tokens from a production document
 * before exporting to portable project JSON.
 */
export function sanitizeProductionForExport(production) {
	if (!production || typeof production !== "object") return null;

	const clone = structuredClone(production);
	if (clone.source) {
		// Ensure connectionId is just an identifier, never a secret
		delete clone.source.apiKey;
		delete clone.source.token;
		delete clone.source.secret;
		delete clone.source.authorization;
	}

	return clone;
}
