/**
 * Time and interval normalisation for 3D production compilation.
 *
 * Conforms to spec 05-compilation-3d:
 * - Canonical 24 fps frame mapping: boundaryFrame = round(seconds * 24).
 * - Intervals: [startFrame, endFrameExclusive).
 * - Rejects empty or inverted intervals.
 * - Local-to-global and global-to-local scene frame conversions.
 */

export const CANONICAL_FPS = 24;

/**
 * Convert seconds to integer frame index at declared fps.
 * @param {number} seconds
 * @param {number} [fps=24]
 * @returns {number}
 */
export function secondsToFrames(seconds, fps = CANONICAL_FPS) {
	const sec = Number(seconds);
	if (!Number.isFinite(sec)) throw new TypeError(`Expected finite seconds, got ${seconds}`);
	return Math.round(sec * fps);
}

/**
 * Convert frame index to seconds.
 * @param {number} frames
 * @param {number} [fps=24]
 * @returns {number}
 */
export function framesToSeconds(frames, fps = CANONICAL_FPS) {
	const f = Number(frames);
	if (!Number.isFinite(f)) throw new TypeError(`Expected finite frames, got ${frames}`);
	return Number((f / fps).toFixed(4));
}

/**
 * Normalise a [startSec, endSec) interval into integer frames [startFrame, endFrameExclusive).
 * Rejects empty or reversed intervals.
 * @param {number} startSec
 * @param {number} endSec
 * @param {number} [fps=24]
 * @returns {{ startFrame: number, endFrameExclusive: number, durationFrames: number }}
 */
export function normalizeInterval(startSec, endSec, fps = CANONICAL_FPS) {
	const startFrame = secondsToFrames(startSec, fps);
	const endFrameExclusive = secondsToFrames(endSec, fps);
	if (startFrame < 0) {
		throw new RangeError(`startFrame (${startFrame}) cannot be negative`);
	}
	if (endFrameExclusive <= startFrame) {
		throw new RangeError(`Interval [${startFrame}, ${endFrameExclusive}) is empty or inverted`);
	}
	return Object.freeze({
		startFrame,
		endFrameExclusive,
		durationFrames: endFrameExclusive - startFrame,
	});
}

/**
 * Convert a local scene frame to global timeline frame.
 * @param {number} localFrame
 * @param {number} sceneGlobalStart
 * @returns {number}
 */
export function localToGlobalFrame(localFrame, sceneGlobalStart) {
	return localFrame + sceneGlobalStart;
}

/**
 * Convert a global timeline frame to local scene frame.
 * @param {number} globalFrame
 * @param {number} sceneGlobalStart
 * @param {number} sceneGlobalEndExclusive
 * @returns {{ localFrame: number, inBounds: boolean }}
 */
export function globalToLocalFrame(globalFrame, sceneGlobalStart, sceneGlobalEndExclusive) {
	const localFrame = globalFrame - sceneGlobalStart;
	const inBounds = globalFrame >= sceneGlobalStart && globalFrame < sceneGlobalEndExclusive;
	return { localFrame, inBounds };
}

/**
 * Normalise scenes and shots into contiguous global and local intervals.
 * @param {Array<{ id: string, durationSec?: number, startSec?: number, endSec?: number, shots?: Array<any> }>} scenes
 * @param {number} [fps=24]
 * @returns {{ scenes: Array<any>, totalFrames: number }}
 */
export function normalizeTimeline(scenes = [], fps = CANONICAL_FPS) {
	let playheadFrame = 0;
	const normalizedScenes = [];

	for (let i = 0; i < scenes.length; i++) {
		const rawScene = scenes[i];
		const durationSec = rawScene.durationSec ?? (rawScene.endSec !== undefined && rawScene.startSec !== undefined ? rawScene.endSec - rawScene.startSec : 0);
		const durationFrames = secondsToFrames(durationSec, fps);
		if (durationFrames <= 0) {
			throw new RangeError(`Scene "${rawScene.id ?? i}" has invalid or zero duration (${durationSec}s -> ${durationFrames} frames)`);
		}
		const sceneStart = playheadFrame;
		const sceneEnd = sceneStart + durationFrames;

		// Normalise shots within the scene
		let shotPlayhead = 0;
		const rawShots = Array.isArray(rawScene.shots) ? rawScene.shots : [];
		const normalizedShots = [];

		for (let s = 0; s < rawShots.length; s++) {
			const rawShot = rawShots[s];
			let shotStart = shotPlayhead;
			let shotEnd;
			if (Number.isFinite(rawShot.startSec) && Number.isFinite(rawShot.endSec)) {
				const interval = normalizeInterval(rawShot.startSec, rawShot.endSec, fps);
				shotStart = interval.startFrame;
				shotEnd = interval.endFrameExclusive;
			} else if (Number.isFinite(rawShot.durationSec)) {
				const d = secondsToFrames(rawShot.durationSec, fps);
				if (d <= 0) throw new RangeError(`Shot "${rawShot.id ?? s}" has invalid duration`);
				shotEnd = shotStart + d;
			} else {
				// Default or proportional: if only shot, takes remaining scene duration
				const remaining = durationFrames - shotPlayhead;
				shotEnd = shotStart + (remaining > 0 ? remaining : 24);
			}

			if (shotEnd <= shotStart) {
				throw new RangeError(`Shot "${rawShot.id ?? s}" interval [${shotStart}, ${shotEnd}) is empty`);
			}
			if (shotEnd > durationFrames) {
				// Clamp or warn
				shotEnd = durationFrames;
			}

			normalizedShots.push(Object.freeze({
				id: rawShot.id ?? `shot_${i + 1}_${s + 1}`,
				name: rawShot.name ?? `Shot ${s + 1}`,
				startFrame: shotStart,
				endFrameExclusive: shotEnd,
				durationFrames: shotEnd - shotStart,
				cameraId: rawShot.cameraId ?? null,
				framing: rawShot.framing ?? null,
			}));
			shotPlayhead = shotEnd;
		}

		// If no shots declared, generate one default shot covering the full scene
		if (!normalizedShots.length) {
			normalizedShots.push(Object.freeze({
				id: `shot_${rawScene.id ?? i + 1}_default`,
				name: "Default Shot",
				startFrame: 0,
				endFrameExclusive: durationFrames,
				durationFrames,
				cameraId: null,
				framing: null,
			}));
		}

		normalizedScenes.push(Object.freeze({
			id: rawScene.id ?? `scene_${i + 1}`,
			name: rawScene.name ?? `Scene ${i + 1}`,
			globalStartFrame: sceneStart,
			globalEndFrameExclusive: sceneEnd,
			durationFrames,
			shots: Object.freeze(normalizedShots),
		}));

		playheadFrame = sceneEnd;
	}

	return Object.freeze({
		scenes: Object.freeze(normalizedScenes),
		totalFrames: playheadFrame,
	});
}
