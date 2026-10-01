/**
 * Avatar Producer for production characters.
 * Conforms to spec 05-compilation-3d §5 and Lot L7.
 *
 * Resolves avatar strategies:
 * - builtin: assigns bundled studio VRM models (SakuraFinal, CHAR_02).
 * - library: resolves existing VRM models from local asset library.
 * - reference: binds given reference resource.
 *
 * Pure and deterministic; network download/GPU generation occurs via separate providers.
 */

export const BUILTIN_AVATAR_MODELS = Object.freeze([
	{ id: "sakura-vrm", name: "Sakura Final", path: "builtin:sakura-vrm", heightMeters: 1.62 },
	{ id: "char-02-vrm", name: "Character 02", path: "builtin:char-02-vrm", heightMeters: 1.75 },
]);

/**
 * Resolves or produces an avatar artifact for an avatar production unit.
 *
 * @param {object} unit ProductionUnit of kind 'avatar'
 * @param {object} [context={}] Runtime context
 * @returns {Promise<object>} Avatar artifact result
 */
export async function produceAvatar(unit, { resources = null, signal = null } = {}) {
	if (signal?.aborted) {
		throw new Error("Avatar production aborted");
	}

	const payload = unit?.payload || {};
	const strategy = payload.strategy || "builtin";
	const characterId = payload.characterId || unit.id.replace(/^avatar_/, "");
	const characterName = payload.name || characterId;

	// 1. Built-in strategy
	if (strategy === "builtin") {
		// Deterministic selection based on character id hash or index
		const idx = Math.abs(characterId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)) % BUILTIN_AVATAR_MODELS.length;
		const model = BUILTIN_AVATAR_MODELS[idx];

		return {
			unitId: unit.id,
			characterId,
			name: characterName,
			vrmUrl: model.path,
			modelId: model.id,
			heightMeters: payload.heightMeters || model.heightMeters,
			nativeHeightMeters: model.heightMeters,
			source: "builtin",
			artifactRef: {
				kind: "vrm",
				hash: unit.inputHash,
				modelId: model.id,
			},
		};
	}

	// 2. Reference resource strategy
	if (strategy === "reference" && payload.referenceResourceId) {
		const res = resources?.get?.(payload.referenceResourceId);
		const url = res?.url || res?.path;
		if (!url) {
			throw new Error(`Referenced resource '${payload.referenceResourceId}' not found for avatar ${characterId}`);
		}
		return {
			unitId: unit.id,
			characterId,
			name: characterName,
			vrmUrl: url,
			heightMeters: payload.heightMeters || 1.70,
			source: "resource",
			artifactRef: {
				kind: "vrm",
				hash: unit.inputHash,
				url,
			},
		};
	}

	throw Object.assign(new Error(`Avatar strategy ${strategy} requires a configured native producer; no fallback was substituted.`), { code: "PRODUCER_NOT_CONFIGURED" });
}
