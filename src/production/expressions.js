/**
 * Expressions — mapping expression narrative → VRM, clés datées indépendantes.
 *
 * Spec : 05-compilation-3d §6.
 *
 * Responsabilités :
 *   - Mapper les noms d'expressions narratives (happy, sad, blink…) vers les
 *     noms réellement disponibles sur un VRM importé.
 *   - Si une expression demandée est absente : signaler « non supporté », jamais
 *     succès fictif.
 *   - Construire une piste de clés d'expressions datées, indépendante des clips
 *     corporels.
 *   - Module pur : pas de Three.js, pas de fetch.
 */

// ---------------------------------------------------------------------------
// Table de mapping narrative → VRM standard (VRM 1.0 preset names)
// ---------------------------------------------------------------------------

/**
 * Mapping de noms narratifs vers les presets VRM 1.0 standards.
 * Un VRM peut implémenter un sous-ensemble de ces presets.
 */
export const NARRATIVE_TO_VRM_PRESET = Object.freeze({
	// Bonheur / positivité
	happy: "happy",
	joy: "happy",
	smile: "happy",
	excited: "happy",

	// Tristesse
	sad: "sad",
	cry: "sad",
	sorrowful: "sad",

	// Colère
	angry: "angry",
	frustrated: "angry",

	// Surprise
	surprised: "surprised",
	shocked: "surprised",

	// Relaxe / neutre
	relaxed: "relaxed",
	calm: "relaxed",
	neutral: "neutral",

	// Clignement
	blink: "blink",
	blinkLeft: "blinkLeft",
	blinkRight: "blinkRight",
	wink: "blinkRight",

	// Regard
	lookUp: "lookUp",
	lookDown: "lookDown",
	lookLeft: "lookLeft",
	lookRight: "lookRight",
});

/** Presets VRM 1.0 reconnus comme standardisés. */
export const VRM_STANDARD_PRESETS = new Set([
	"happy", "angry", "sad", "surprised", "relaxed", "neutral",
	"blink", "blinkLeft", "blinkRight",
	"lookUp", "lookDown", "lookLeft", "lookRight",
	"aa", "ih", "ou", "ee", "oh", // Mouth shapes (TTS lip sync)
]);

// ---------------------------------------------------------------------------
// resolveExpression
// ---------------------------------------------------------------------------

/**
 * Résout un nom d'expression narrative vers un nom VRM disponible.
 *
 * @param {string}   narrativeName  Nom narratif (ex: "happy", "blink")
 * @param {Set<string>} available   Noms disponibles sur le VRM chargé
 * @returns {{ resolved: string|null, unsupported: boolean, reason: string|null }}
 */
export function resolveExpression(narrativeName, available) {
	if (!narrativeName) {
		return { resolved: null, unsupported: true, reason: "empty-name" };
	}

	// Correspondance directe
	if (available.has(narrativeName)) {
		return { resolved: narrativeName, unsupported: false, reason: null };
	}

	// Lookup via table narrative → preset VRM
	const preset = NARRATIVE_TO_VRM_PRESET[narrativeName];
	if (preset && available.has(preset)) {
		return { resolved: preset, unsupported: false, reason: null };
	}

	// Essai insensible à la casse (last resort)
	const lc = narrativeName.toLowerCase();
	for (const name of available) {
		if (name.toLowerCase() === lc) {
			return { resolved: name, unsupported: false, reason: null };
		}
	}

	return {
		resolved: null,
		unsupported: true,
		reason: `expression "${narrativeName}" not found in VRM (available: ${[...available].join(", ")})`,
	};
}

// ---------------------------------------------------------------------------
// ExpressionKey
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ExpressionKey
 * @property {number}  frame         Frame locale dans la scène
 * @property {string}  expression    Nom VRM résolu
 * @property {number}  weight        [0, 1]
 * @property {'step'|'linear'|'blend'} interpolation
 */

/**
 * Crée une clé d'expression validée.
 * @param {object} def
 * @returns {ExpressionKey}
 */
export function createExpressionKey(def) {
	const { frame, expression, weight = 1, interpolation = "linear" } = def ?? {};
	if (typeof frame !== "number") throw new TypeError("ExpressionKey: frame must be a number.");
	if (!expression) throw new TypeError("ExpressionKey: expression is required.");
	if (weight < 0 || weight > 1) throw new RangeError("ExpressionKey: weight must be in [0, 1].");
	return Object.freeze({ frame, expression, weight, interpolation });
}

// ---------------------------------------------------------------------------
// ExpressionTrack
// ---------------------------------------------------------------------------

/**
 * Piste d'expressions datées pour un personnage dans une scène.
 * Indépendante des clips corporels.
 *
 * @param {object[]} keys    Tableau de ExpressionKey
 * @returns {object}
 */
export function createExpressionTrack(keys) {
	if (!Array.isArray(keys)) {
		throw new TypeError("createExpressionTrack: keys must be an array.");
	}

	// Trier par frame croissante
	const sorted = [...keys].sort((a, b) => a.frame - b.frame);

	/**
	 * Évalue le poids d'une expression à une frame donnée.
	 * Interpolation linéaire entre les clés voisines.
	 * @param {string} expressionName
	 * @param {number} frame
	 * @returns {number} weight [0, 1]
	 */
	function evalAt(expressionName, frame) {
		const track = sorted.filter((k) => k.expression === expressionName);
		if (track.length === 0) return 0;

		// Avant la première clé
		if (frame <= track[0].frame) return track[0].weight;
		// Après la dernière clé
		if (frame >= track[track.length - 1].frame) return track[track.length - 1].weight;

		// Interpolation entre deux clés
		for (let i = 0; i < track.length - 1; i++) {
			const k0 = track[i];
			const k1 = track[i + 1];
			if (frame >= k0.frame && frame < k1.frame) {
				if (k0.interpolation === "step") return k0.weight;
				const t = (frame - k0.frame) / Math.max(1, k1.frame - k0.frame);
				return k0.weight + t * (k1.weight - k0.weight);
			}
		}
		return 0;
	}

	/**
	 * Retourne l'ensemble des expressions actives à une frame (weight > 0).
	 * @param {number} frame
	 * @returns {Map<string, number>}
	 */
	function activeAt(frame) {
		const names = new Set(sorted.map((k) => k.expression));
		const result = new Map();
		for (const name of names) {
			const w = evalAt(name, frame);
			if (w > 0) result.set(name, w);
		}
		return result;
	}

	return Object.freeze({ keys: Object.freeze(sorted), evalAt, activeAt });
}

// ---------------------------------------------------------------------------
// buildExpressionTrackFromActions
// ---------------------------------------------------------------------------

/**
 * Construit une piste d'expressions depuis les actions narratives d'une scène.
 * Signale les expressions non supportées sans bloquer les autres.
 *
 * @param {object[]} actions     Actions narratives avec type:"expression"
 * @param {Set<string>} available  Expressions disponibles sur le VRM
 * @param {number}   [fps]       Fréquence canonique (défaut 24)
 * @returns {{ track: object, unsupported: string[] }}
 */
export function buildExpressionTrackFromActions(actions, available, fps = 24) {
	const keys = [];
	const unsupported = [];

	for (const action of actions ?? []) {
		if (action.type !== "expression" && action.kind !== "expression") continue;

		const { resolved, unsupported: isUnsupported, reason } = resolveExpression(action.expression ?? action.name, available);

		if (isUnsupported) {
			unsupported.push(reason ?? action.expression);
			continue;
		}

		const startFrame = Math.round((action.startSeconds ?? action.startFrame / fps ?? 0) * fps);
		const endFrame = action.endSeconds != null
			? Math.round(action.endSeconds * fps)
			: action.endFrameExclusive ?? startFrame + fps; // défaut : 1 seconde

		// Clé montante
		keys.push(createExpressionKey({
			frame: startFrame,
			expression: resolved,
			weight: action.weight ?? 1,
			interpolation: action.interpolation ?? "linear",
		}));

		// Clé descendante si durée définie
		if (endFrame > startFrame) {
			keys.push(createExpressionKey({
				frame: endFrame,
				expression: resolved,
				weight: 0,
				interpolation: action.interpolation ?? "linear",
			}));
		}
	}

	return { track: createExpressionTrack(keys), unsupported };
}
