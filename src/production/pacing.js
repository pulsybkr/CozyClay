/**
 * Pacing production — énergie squelettique, idempotence changed:false.
 *
 * Spec : 06-correctifs C6.
 *
 * Différences avec src/ardy/pace.js (pace existant pour VRM brut) :
 *   - Ce module opère sur la COMPOSITION courante (clips produits, segments assemblés),
 *     pas sur fullMotionFor brut.
 *   - L'énergie inclut articulations ET rotations root, pas seulement translation root x/z.
 *   - Les déplacements sont normalisés par la taille du personnage.
 *   - Deux appels avec mêmes données → changed:false, sans écrasement d'un montage existant.
 *   - Les contacts/impacts déclarés dans une InteractionTrack sont protégés.
 *   - Les holds intentionnels, idles, silences et immobilités root sont identifiés séparément.
 *   - Module pur : aucun appel réseau, aucune mutation de scène.
 */

import { CANONICAL_FPS } from "./normalize.js";

// ---------------------------------------------------------------------------
// Constantes (alignées sur src/ardy/pace.js mais pour la composition)
// ---------------------------------------------------------------------------

/** Root speed (m/s) sous laquelle une frame est « debout immobile ». */
export const STILL_SPEED = 0.02;

/** Part de frames immobiles au-dessus de laquelle le take est padded. */
export const DEAD_AIR_SHARE = 0.25;

/** Vitesse en dessous de laquelle un take lire comme sluggish. */
export const SLUGGISH_SPEED = 0.18;

/** Vitesse max demandée par ce module. */
export const MAX_PACE_SPEED = 2.0;

/** Vitesse min (pas de ralentissement). */
export const SPEED_MIN = 1.0;

/** Seuil rotation root (radians/frame) en dessous duquel la rotation root est statique. */
export const STILL_ROT_THRESHOLD = 0.005;

/** Seuil énergie articulaire (rad/frame par articulation, normalisé). */
export const STILL_JOINT_THRESHOLD = 0.003;

/** Nombre de frames de fenêtre pour hold intentionnel (pose tenue). */
export const HOLD_WINDOW_FRAMES = 8;

// ---------------------------------------------------------------------------
// Types de segments de pace
// ---------------------------------------------------------------------------
export const PACE_LABEL = Object.freeze({
	ACTIVE: "active",           // Mouvement significatif
	HOLD: "hold",               // Pose tenue volontairement
	IDLE: "idle",               // Idle (légère oscillation)
	DEAD_AIR: "dead-air",       // Immobilité non intentionnelle
	CONTACT: "contact",         // Frame protégée par interaction
});

// ---------------------------------------------------------------------------
// analyzeCompositionPacing
// ---------------------------------------------------------------------------

/**
 * Analyse le pacing d'une composition de clips (timeline d'un acteur).
 *
 * @param {object} composedClip
 *   { frames: Array<{rootDx,rootDz,rootRotY,jointEnergies:[number], characterHeight}> }
 * @param {object} [options]
 * @param {number} [options.characterHeight]    Taille en mètres (normalisation)
 * @param {number} [options.fps]
 * @param {Set<number>} [options.protectedFrames]  Frames de contact protégées
 * @returns {object} Rapport d'analyse
 */
export function analyzeCompositionPacing(composedClip, options = {}) {
	const {
		characterHeight = 1.7,
		fps = CANONICAL_FPS,
		protectedFrames = new Set(),
	} = options;

	const frames = composedClip?.frames ?? [];
	if (frames.length < 2) {
		return {
			enough: false,
			reason: "too-few-frames",
			labels: [],
			deadAirShare: 0,
			maxSpeed: 0,
			sluggish: false,
		};
	}

	const heightNorm = Math.max(0.1, characterHeight);
	const labels = [];
	let deadAirCount = 0;
	let maxSpeed = 0;

	for (let i = 0; i < frames.length; i++) {
		const f = frames[i];

		// Protégé par contact/impact
		if (protectedFrames.has(i)) {
			labels.push(PACE_LABEL.CONTACT);
			continue;
		}

		// Énergie root translation (normalisée par taille personnage)
		const rootDx = f.rootDx ?? 0;
		const rootDz = f.rootDz ?? 0;
		const rootSpeed = Math.sqrt(rootDx * rootDx + rootDz * rootDz) * fps / heightNorm;

		// Énergie root rotation
		const rootRotY = Math.abs(f.rootRotY ?? 0); // radians/frame

		// Énergie articulaire (moyenne des articulations)
		const joints = f.jointEnergies ?? [];
		const jointEnergy = joints.length > 0
			? joints.reduce((s, e) => s + Math.abs(e), 0) / joints.length
			: 0;

		// Énergie totale
		const totalEnergy = rootSpeed + rootRotY / STILL_ROT_THRESHOLD * STILL_SPEED + jointEnergy / STILL_JOINT_THRESHOLD * STILL_SPEED;

		if (rootSpeed > maxSpeed) maxSpeed = rootSpeed;

		// Classification
		if (rootSpeed < STILL_SPEED && rootRotY < STILL_ROT_THRESHOLD && jointEnergy < STILL_JOINT_THRESHOLD) {
			// Distinguer hold intentionnel vs dead-air
			const isHold = isIntentionalHold(frames, i, HOLD_WINDOW_FRAMES);
			if (isHold) {
				labels.push(PACE_LABEL.HOLD);
			} else {
				labels.push(PACE_LABEL.DEAD_AIR);
				deadAirCount++;
			}
		} else if (rootSpeed < STILL_SPEED && jointEnergy >= STILL_JOINT_THRESHOLD) {
			labels.push(PACE_LABEL.IDLE);
		} else {
			labels.push(PACE_LABEL.ACTIVE);
		}
	}

	const deadAirShare = frames.length > 0 ? deadAirCount / frames.length : 0;
	const sluggish = maxSpeed < SLUGGISH_SPEED && deadAirShare < DEAD_AIR_SHARE && labels.some((l) => l === PACE_LABEL.ACTIVE);

	return {
		enough: true,
		labels,
		deadAirShare,
		maxSpeed,
		sluggish,
		deadAirCount,
		totalFrames: frames.length,
	};
}

// ---------------------------------------------------------------------------
// planPacingSegments
// ---------------------------------------------------------------------------

/**
 * Planifie les segments de rétiming depuis l'analyse de pacing.
 *
 * Retourne { segments, changed } — changed:false si aucune modification utile.
 *
 * @param {object} analysis   Résultat de analyzeCompositionPacing
 * @param {object} [options]
 * @param {number} [options.speedup]    Vitesse max demandée (1–MAX_PACE_SPEED)
 * @param {number} [options.currentSpeedup]  Vitesse actuelle appliquée (pour idempotence)
 * @returns {{ changed: boolean, segments: object[], report: object }}
 */
export function planPacingSegments(analysis, options = {}) {
	const { speedup = 1.5, currentSpeedup = 1.0 } = options;

	if (!analysis.enough) {
		return { changed: false, segments: [], report: { reason: analysis.reason } };
	}

	const clampedSpeedup = Math.min(MAX_PACE_SPEED, Math.max(SPEED_MIN, speedup));

	// Idempotence : si le speedup demandé est le même que l'actuel → changed:false
	if (Math.abs(clampedSpeedup - currentSpeedup) < 0.001 && analysis.deadAirShare < DEAD_AIR_SHARE && !analysis.sluggish) {
		return { changed: false, segments: [], report: { reason: "already-optimal", speedup: clampedSpeedup } };
	}

	const { labels } = analysis;
	if (!labels || labels.length === 0) {
		return { changed: false, segments: [], report: { reason: "no-labels" } };
	}

	// Grouper les frames consécutives par label
	const runs = [];
	let runStart = 0;
	let runLabel = labels[0];
	for (let i = 1; i <= labels.length; i++) {
		if (i === labels.length || labels[i] !== runLabel) {
			runs.push({ startFrame: runStart, endFrame: i, label: runLabel });
			runStart = i;
			runLabel = labels[i];
		}
	}

	// Construire les segments
	const segments = runs.map((run) => {
		let rate = 1.0;
		if (run.label === PACE_LABEL.DEAD_AIR) {
			rate = clampedSpeedup;
		} else if (run.label === PACE_LABEL.IDLE) {
			rate = Math.min(clampedSpeedup, 1.2);
		} else if (run.label === PACE_LABEL.CONTACT) {
			rate = 1.0; // Contact protégé
		}
		return {
			srcStart: run.startFrame,
			srcEnd: run.endFrame,
			rate,
			label: run.label,
		};
	});

	// Si aucun segment ne change → changed:false
	const hasChange = segments.some((s) => Math.abs(s.rate - 1.0) > 0.001);
	if (!hasChange) {
		return { changed: false, segments: [], report: { reason: "no-change-needed" } };
	}

	return {
		changed: true,
		segments,
		report: { speedup: clampedSpeedup, deadAirShare: analysis.deadAirShare, sluggish: analysis.sluggish },
	};
}

// ---------------------------------------------------------------------------
// applyPacingToClip
// ---------------------------------------------------------------------------

/**
 * Applique le plan de segments à un clip.
 * Idempotent : si le clip a déjà ces segments, changed:false.
 *
 * @param {object}   clip      Clip avec .segments actuels
 * @param {object[]} newSegs   Segments proposés par planPacingSegments
 * @returns {{ changed: boolean, clip: object }}
 */
export function applyPacingToClip(clip, newSegs) {
	const current = clip?.segments ?? [];

	// Comparer les segments (idempotence)
	if (segmentsEqual(current, newSegs)) {
		return { changed: false, clip };
	}

	return {
		changed: true,
		clip: { ...clip, segments: newSegs },
	};
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

/**
 * Détermine si une frame statique est un hold intentionnel
 * (entourée d'autres frames statiques sur HOLD_WINDOW_FRAMES de chaque côté).
 */
function isIntentionalHold(frames, idx, window) {
	const start = Math.max(0, idx - window);
	const end = Math.min(frames.length - 1, idx + window);
	let stillCount = 0;
	for (let i = start; i <= end; i++) {
		const f = frames[i];
		const rootSpeed = Math.sqrt((f.rootDx ?? 0) ** 2 + (f.rootDz ?? 0) ** 2);
		if (rootSpeed < STILL_SPEED && Math.abs(f.rootRotY ?? 0) < STILL_ROT_THRESHOLD) {
			stillCount++;
		}
	}
	// Hold intentionnel : majorité de frames statiques dans la fenêtre
	return stillCount > (end - start + 1) * 0.6;
}

/** Compare deux tableaux de segments pour idempotence. */
function segmentsEqual(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i].srcStart !== b[i].srcStart || a[i].srcEnd !== b[i].srcEnd || Math.abs((a[i].rate ?? 1) - (b[i].rate ?? 1)) > 0.001) {
			return false;
		}
	}
	return true;
}
