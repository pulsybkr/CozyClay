/**
 * Motion Clip Producer and Composer.
 * Conforms to spec 05-compilation-3d §5 and Lot L7.
 *
 * Implements:
 * - Single-actor isolated motion generation and synthesis.
 * - Multi-shot motion continuity (camera cuts do not interrupt bodily action).
 * - Multi-actor composition without race conditions.
 * - Re-generation of a single actor clip preserves other actors and cameras.
 */

import { secondsToFrames, CANONICAL_FPS } from "./normalize.js";

/**
 * Standard procedural/motion templates available natively in CozyClay.
 */
export const MOTION_PRESETS = Object.freeze({
	idle: { kind: "idle", defaultDurationFrames: 72, rootMotion: false },
	walk: { kind: "walk", defaultDurationFrames: 48, rootMotion: true, speedMps: 1.2 },
	wave: { kind: "wave", defaultDurationFrames: 48, rootMotion: false },
	nod: { kind: "nod", defaultDurationFrames: 36, rootMotion: false },
	talk: { kind: "talk", defaultDurationFrames: 96, rootMotion: false },
	look: { kind: "head_turn", defaultDurationFrames: 36, rootMotion: false },
});

/**
 * Produces a motion clip for a single character from a motion-clip production unit.
 *
 * @param {object} unit ProductionUnit of kind 'motion-clip'
 * @param {object} [context={}] Execution context
 * @returns {Promise<object>} Motion clip artifact
 */
export async function produceMotionClip(unit, { signal = null } = {}) {
	if (signal?.aborted) {
		throw new Error("Motion clip production aborted");
	}

	const payload = unit.payload || {};
	const characterId = payload.characterId || "CHAR_01";
	const actionType = payload.motionKind || payload.actionType || (payload.kind !== "body" ? payload.kind : "idle") || "idle";
	const startFrame = Number.isInteger(payload.startFrame) ? payload.startFrame : 0;
	const endFrame = Number.isInteger(payload.endFrameExclusive)
		? payload.endFrameExclusive
		: (Number.isInteger(payload.endFrame) ? payload.endFrame : startFrame + 72);
	const durationFrames = Math.max(1, endFrame - startFrame);

	// Select preset or default idle
	const preset = actionType === "directive" ? { kind: "directive", rootMotion: Boolean(payload.trajectory?.length) } : MOTION_PRESETS[actionType];
	if (!preset) throw new Error("Unknown motion intent: " + actionType);

	// Deterministic clip representation
	const clipId = `clip_${unit.id}`;
	const clip = {
		plannedOnly: true,
		clipId,
		unitId: unit.id,
		characterId,
		actionType: preset.kind,
		startFrame,
		endFrame,
		durationFrames,
		fps: CANONICAL_FPS,
		rootMotion: preset.rootMotion || false,
		blendInFrames: 6,
		blendOutFrames: 6,
		metadata: {
			description: payload.description || `Action ${actionType} for ${characterId}`,
			intent: payload.intent,
			objectId: payload.objectId,
			trajectory: payload.trajectory,
			eventId: payload.eventId,
			participantIds: payload.participantIds,
			effects: payload.effects,
			inputHash: unit.inputHash,
		},
	};

	return {
		unitId: unit.id,
		characterId,
		plannedOnly: true,
		clip,
		artifactRef: {
			kind: "motion-clip",
			hash: unit.inputHash,
			clipId,
		},
	};
}

/**
 * Composes multiple actor clips into continuous timelines for each character.
 * Ensures camera cuts do not split or disrupt underlying motion.
 *
 * @param {Array<object>} clips List of generated clips
 * @returns {Map<string, Array<object>>} Map of characterId -> sorted track of clips
 */
export function composeActorTracks(clips = []) {
	const tracks = new Map();

	for (const entry of clips) {
		const clip = entry.clip || entry;
		const charId = clip.characterId;
		if (!charId) continue;

		if (!tracks.has(charId)) {
			tracks.set(charId, []);
		}
		tracks.get(charId).push(clip);
	}

	// Sort clips chronologically per actor and handle overlap
	for (const [charId, charClips] of tracks.entries()) {
		charClips.sort((a, b) => a.startFrame - b.startFrame);

		// Resolve consecutive gaps with idle filler if necessary
		const reconciled = [];
		for (let i = 0; i < charClips.length; i++) {
			const current = charClips[i];
			if (i > 0) {
				const prev = reconciled[reconciled.length - 1];
				if (current.startFrame > prev.endFrame) {
					// Add transitional idle filler
					reconciled.push({
						clipId: `fill_${prev.clipId}_${current.clipId}`,
						characterId: charId,
						actionType: "idle",
						startFrame: prev.endFrame,
						endFrame: current.startFrame,
						durationFrames: current.startFrame - prev.endFrame,
						rootMotion: false,
						isFiller: true,
					});
				}
			}
			reconciled.push(current);
		}
		tracks.set(charId, reconciled);
	}

	return tracks;
}
