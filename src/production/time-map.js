/**
 * TimeMap — carte temporelle globale ↔ locale pour production multi-scène.
 *
 * Spec : 06-correctifs C7, 05 §§1 et 8.
 *
 * Responsabilités :
 *   - Mapper une frame globale (montage) vers (scèneId, framLocale, shotIndex).
 *   - Effectuer un trim mono-clip sans toucher à la timeline globale.
 *   - Effectuer un ripple global : remappe toutes les pistes de tous les acteurs,
 *     caméras, expressions, interactions et narration.
 *   - Garantir idempotence : deux appels identiques → changed:false.
 *   - Pure, sans mutation de scène, sans appel réseau.
 */

import { secondsToFrames, CANONICAL_FPS } from "./normalize.js";

// ---------------------------------------------------------------------------
// Types internes (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SceneSpan
 * @property {string} sceneId
 * @property {number} startGlobal  Frame globale inclusive
 * @property {number} endGlobal    Frame globale exclusive
 */

/**
 * @typedef {object} LocalFrame
 * @property {string}  sceneId
 * @property {number}  localFrame   Frame locale dans la scène
 * @property {number}  shotIndex    Index du shot dans la scène (-1 si hors shot)
 * @property {number}  globalFrame
 */

/**
 * @typedef {object} TimeMapSegment
 * @property {number} srcStart    Frame source (locale) inclusive
 * @property {number} srcEnd      Frame source (locale) exclusive
 * @property {number} dstStart    Frame destination (locale) inclusive
 * @property {number} dstEnd      Frame destination (locale) exclusive
 * @property {number} rate        dstDuration / srcDuration (1 = unchanged)
 */

// ---------------------------------------------------------------------------
// createTimeMap
// ---------------------------------------------------------------------------

/**
 * Construit une carte temporelle à partir d'une liste ordonnée de scènes.
 *
 * @param {SceneSpan[]} scenes  Scènes ordonnées avec leurs bornes globales
 * @returns {object}  Interface TimeMap
 */
export function createTimeMap(scenes) {
	if (!Array.isArray(scenes) || scenes.length === 0) {
		throw new RangeError("TimeMap: scenes must be a non-empty array.");
	}

	// Vérifier la continuité
	for (let i = 0; i < scenes.length; i++) {
		const s = scenes[i];
		if (typeof s.startGlobal !== "number" || typeof s.endGlobal !== "number") {
			throw new TypeError(`TimeMap: scene[${i}] is missing startGlobal/endGlobal.`);
		}
		if (s.startGlobal >= s.endGlobal) {
			throw new RangeError(`TimeMap: scene[${i}] has empty or inverted range [${s.startGlobal}, ${s.endGlobal}).`);
		}
		if (i > 0 && scenes[i].startGlobal !== scenes[i - 1].endGlobal) {
			throw new RangeError(`TimeMap: gap or overlap between scene[${i - 1}] and scene[${i}].`);
		}
	}

	const totalFrames = scenes[scenes.length - 1].endGlobal;

	// ---------------------------------------------------------------------------
	// Résoudre frame globale → (scène, frame locale)
	// ---------------------------------------------------------------------------
	function resolve(globalFrame) {
		if (globalFrame < 0 || globalFrame >= totalFrames) {
			return null;
		}
		for (const scene of scenes) {
			if (globalFrame >= scene.startGlobal && globalFrame < scene.endGlobal) {
				return {
					sceneId: scene.sceneId,
					localFrame: globalFrame - scene.startGlobal,
					globalFrame,
					shotIndex: -1, // enrichi par resolveShot si shots fournis
				};
			}
		}
		return null;
	}

	// ---------------------------------------------------------------------------
	// Résoudre (scèneId, frame locale) → frame globale
	// ---------------------------------------------------------------------------
	function toGlobal(sceneId, localFrame) {
		const scene = scenes.find((s) => s.sceneId === sceneId);
		if (!scene) return null;
		const g = scene.startGlobal + localFrame;
		if (g >= scene.endGlobal) return null;
		return g;
	}

	// ---------------------------------------------------------------------------
	// Trim mono-clip : ajuste les bornes d'un clip source dans sa fenêtre narrative
	// sans modifier la timeline des autres pistes.
	//
	// Retourne { segments, changed } où segments est un tableau de TimeMapSegment.
	// changed:false si les bornes demandées correspondent déjà aux bornes actuelles.
	// ---------------------------------------------------------------------------
	function trimClip(clip, newSrcStart, newSrcEnd) {
		const srcStart = clip.srcStart ?? clip.startFrame ?? 0;
		const srcEnd = clip.srcEnd ?? clip.endFrameExclusive ?? clip.endFrame ?? srcStart;

		// Idempotence
		if (newSrcStart === srcStart && newSrcEnd === srcEnd) {
			return { changed: false, segments: clipToSegments(clip) };
		}

		if (newSrcStart >= newSrcEnd) {
			throw new RangeError("trimClip: newSrcStart must be < newSrcEnd.");
		}

		// Le trim ne modifie que la fenêtre source ; la fenêtre destination (narrative) reste identique.
		const dstStart = clip.dstStart ?? clip.startFrame ?? 0;
		const dstEnd = clip.dstEnd ?? clip.endFrameExclusive ?? clip.endFrame ?? dstStart;
		const dstDuration = dstEnd - dstStart;
		const newSrcDuration = newSrcEnd - newSrcStart;
		const rate = dstDuration / Math.max(1, newSrcDuration);

		return {
			changed: true,
			segments: [{ srcStart: newSrcStart, srcEnd: newSrcEnd, dstStart, dstEnd, rate }],
		};
	}

	// ---------------------------------------------------------------------------
	// Ripple global : décale toutes les frames >= pivotGlobal de `deltaFrames`.
	//
	// Les pistes dont l'owner ne sait pas remapper sont listées dans `unsupported`
	// et la commande est REFUSÉE si unsupported.length > 0 (spec C7).
	//
	// @param {number}   pivotGlobal   Frame globale à partir de laquelle le ripple s'applique
	// @param {number}   deltaFrames   Décalage en frames (positif = étirer, négatif = rétrécir)
	// @param {object[]} tracks        Pistes à remapper [{kind, sceneId, frames[]}]
	// @returns {{ changed:boolean, remapped:object[], unsupported:string[] }}
	// ---------------------------------------------------------------------------
	function ripple(pivotGlobal, deltaFrames, tracks) {
		if (!Array.isArray(tracks)) {
			throw new TypeError("ripple: tracks must be an array.");
		}

		const KNOWN_KINDS = new Set(["motion-clip", "camera-key", "expression-key", "interaction", "shot"]);
		const unsupported = [];
		for (const t of tracks) {
			if (!KNOWN_KINDS.has(t.kind)) {
				unsupported.push(`${t.kind}:${t.id ?? "unknown"}`);
			}
		}

		if (unsupported.length > 0) {
			return { changed: false, remapped: [], unsupported };
		}

		if (deltaFrames === 0) {
			return { changed: false, remapped: tracks, unsupported: [] };
		}

		// Remapper chaque piste
		const remapped = tracks.map((track) => {
			const frames = (track.frames ?? []).map((f) => {
				const gf = typeof f.globalFrame === "number" ? f.globalFrame : toGlobal(track.sceneId, f.localFrame ?? f.frame ?? 0) ?? 0;
				if (gf >= pivotGlobal) {
					const newGlobal = Math.max(0, gf + deltaFrames);
					const resolved = resolve(newGlobal);
					return { ...f, globalFrame: newGlobal, localFrame: resolved?.localFrame ?? f.localFrame };
				}
				return f;
			});
			// Bornes du clip
			const remapBound = (v) => {
				if (typeof v !== "number") return v;
				const gv = toGlobal(track.sceneId, v);
				if (gv !== null && gv >= pivotGlobal) return Math.max(0, v + deltaFrames);
				return v;
			};
			return {
				...track,
				frames,
				startFrame: remapBound(track.startFrame),
				endFrameExclusive: remapBound(track.endFrameExclusive),
			};
		});

		return { changed: true, remapped, unsupported: [] };
	}

	// ---------------------------------------------------------------------------
	// Helpers internes
	// ---------------------------------------------------------------------------
	function clipToSegments(clip) {
		const srcStart = clip.srcStart ?? clip.startFrame ?? 0;
		const srcEnd = clip.srcEnd ?? clip.endFrameExclusive ?? clip.endFrame ?? srcStart;
		const dstStart = clip.dstStart ?? clip.startFrame ?? 0;
		const dstEnd = clip.dstEnd ?? clip.endFrameExclusive ?? clip.endFrame ?? dstStart;
		const srcDuration = srcEnd - srcStart;
		const dstDuration = dstEnd - dstStart;
		const rate = srcDuration > 0 ? dstDuration / srcDuration : 1;
		return [{ srcStart, srcEnd, dstStart, dstEnd, rate }];
	}

	return Object.freeze({
		resolve,
		toGlobal,
		trimClip,
		ripple,
		totalFrames,
		scenes: Object.freeze(scenes.map((s) => ({ ...s }))),
	});
}

// ---------------------------------------------------------------------------
// buildTimeMapFromSnapshot
// ---------------------------------------------------------------------------

/**
 * Construit un TimeMap directement depuis le snapshot de production.
 * Chaque scène occupe consecutivement la timeline globale.
 *
 * @param {object}   snapshot  Snapshot cozy-story-v1
 * @param {number}   [fps]     Fréquence (défaut : CANONICAL_FPS = 24)
 * @returns {object} TimeMap
 */
export function buildTimeMapFromSnapshot(snapshot, fps = CANONICAL_FPS) {
	const scenes = snapshot?.scenes ?? [];
	if (scenes.length === 0) {
		throw new RangeError("buildTimeMapFromSnapshot: snapshot has no scenes.");
	}

	let cursor = 0;
	const spans = scenes.map((scene) => {
		const durationFrames = secondsToFrames(scene.durationSeconds ?? 0, fps);
		if (durationFrames <= 0) {
			throw new RangeError(`buildTimeMapFromSnapshot: scene ${scene.id} has zero duration.`);
		}
		const span = { sceneId: scene.id, startGlobal: cursor, endGlobal: cursor + durationFrames };
		cursor += durationFrames;
		return span;
	});

	return createTimeMap(spans);
}

// ---------------------------------------------------------------------------
// Utilitaire : mapper un tableau de frames locales vers des frames globales
// ---------------------------------------------------------------------------

/**
 * @param {object} timeMap
 * @param {string} sceneId
 * @param {number[]} localFrames
 * @returns {(number|null)[]}
 */
export function localToGlobalBatch(timeMap, sceneId, localFrames) {
	return localFrames.map((f) => timeMap.toGlobal(sceneId, f));
}
