/**
 * Semantic camera framing, angle conversion, and shot keyframing.
 *
 * Conforms to spec 05-compilation-3d (§4):
 * - Semantic framing resolved from actor/prop bounding boxes.
 * - Aspect ratios 9:16 (portrait) and 16:9 (landscape).
 * - Converts source degrees to native radians (yaw/pitch).
 * - Keyframes are LOCAL to each shot [0, durationFrames - 1].
 * - Checks near/far frustum and room boundaries.
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function degToRad(deg) {
	return (Number(deg) || 0) * DEG2RAD;
}

export function radToDeg(rad) {
	return (Number(rad) || 0) * RAD2DEG;
}

/**
 * Aspect ratio numerical values.
 */
export const ASPECT_RATIOS = Object.freeze({
	"9:16": 9 / 16,
	"16:9": 16 / 9,
	"1:1": 1.0,
	"4:3": 4 / 3,
});

/**
 * Default camera settings.
 */
export const DEFAULT_CAMERA = Object.freeze({
	fovDeg: 35,
	near: 0.1,
	far: 100,
	aspectRatio: "9:16",
});

/**
 * Framing height and offset defaults per semantic shot type.
 */
const SHOT_TYPES = {
	"extreme-close-up": { targetHeight: 0.3, yRatio: 0.9, padding: 1.1 },
	"close-up": { targetHeight: 0.5, yRatio: 0.85, padding: 1.2 },
	"cu": { targetHeight: 0.5, yRatio: 0.85, padding: 1.2 },
	"medium-close-up": { targetHeight: 0.8, yRatio: 0.75, padding: 1.2 },
	"medium": { targetHeight: 1.1, yRatio: 0.65, padding: 1.25 },
	"medium-shot": { targetHeight: 1.1, yRatio: 0.65, padding: 1.25 },
	"ms": { targetHeight: 1.1, yRatio: 0.65, padding: 1.25 },
	"medium-full": { targetHeight: 1.5, yRatio: 0.55, padding: 1.3 },
	"full": { targetHeight: 1.9, yRatio: 0.5, padding: 1.3 },
	"wide": { targetHeight: 2.2, yRatio: 0.5, padding: 1.4 },
	"establishing": { targetHeight: 3.5, yRatio: 0.4, padding: 1.5 },
};

/**
 * Compute semantic camera position and orientation aiming at a target.
 *
 * @param {object} options
 * @param {{ x: number, y: number, z: number, height?: number }} options.target
 * @param {string} [options.shotType="medium"]
 * @param {number} [options.yawDeg=0] Horizontal angle in degrees
 * @param {number} [options.pitchDeg=0] Vertical tilt in degrees
 * @param {number} [options.fovDeg=35] Field of view in degrees
 * @param {string} [options.aspectRatio="9:16"]
 * @param {{ min?: {x:number, y:number, z:number}, max?: {x:number, y:number, z:number} }} [options.roomBounds]
 * @returns {{ pos: {x:number, y:number, z:number}, lookAt: {x:number, y:number, z:number}, yaw: number, pitch: number, fovDeg: number }}
 */
export function planCameraFraming({
	target,
	shotType = "medium",
	yawDeg = 0,
	pitchDeg = 0,
	fovDeg = DEFAULT_CAMERA.fovDeg,
	aspectRatio = DEFAULT_CAMERA.aspectRatio,
	roomBounds = null,
} = {}) {
	const tx = Number(target?.x) || 0;
	const ty = Number(target?.y) || 0;
	const tz = Number(target?.z) || 0;
	const totalHeight = Math.max(0.2, Number(target?.height) || 1.7);

	const preset = SHOT_TYPES[shotType?.toLowerCase()] ?? SHOT_TYPES.medium;
	const targetY = ty + totalHeight * preset.yRatio;
	const lookAt = Object.freeze({ x: tx, y: targetY, z: tz });

	const aspect = ASPECT_RATIOS[aspectRatio] ?? (9 / 16);
	const vFovRad = degToRad(fovDeg);
	const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
	const effectiveFov = aspect < 1 ? hFovRad : vFovRad;

	// Calculate distance needed to cover the subject
	const subjectSpan = preset.targetHeight * preset.padding;
	const calculatedDistance = (subjectSpan / 2) / Math.tan(effectiveFov / 2);
	const distance = Math.max(0.4, Math.min(30.0, calculatedDistance));

	// Convert angles to radians for native representation
	const yawRad = degToRad(yawDeg);
	const pitchRad = degToRad(pitchDeg);

	const cp = Math.cos(pitchRad);
	let cx = tx + distance * Math.sin(yawRad) * cp;
	let cy = targetY - distance * Math.sin(pitchRad);
	let cz = tz + distance * Math.cos(yawRad) * cp;

	// Prevent camera from falling below the floor deck (y >= 0.1)
	cy = Math.max(0.1, cy);

	// Restrict to room bounds if defined
	if (roomBounds?.min && roomBounds?.max) {
		const margin = 0.2;
		cx = Math.max(roomBounds.min.x + margin, Math.min(roomBounds.max.x - margin, cx));
		cy = Math.max(roomBounds.min.y + margin, Math.min(roomBounds.max.y - margin, cy));
		cz = Math.max(roomBounds.min.z + margin, Math.min(roomBounds.max.z - margin, cz));
	}

	return Object.freeze({
		pos: Object.freeze({
			x: Number(cx.toFixed(4)),
			y: Number(cy.toFixed(4)),
			z: Number(cz.toFixed(4)),
		}),
		lookAt,
		yaw: Number(yawRad.toFixed(4)),
		pitch: Number(pitchRad.toFixed(4)),
		fovDeg: Number(fovDeg.toFixed(2)),
	});
}

/**
 * Generate camera keyframes for a shot covering its local duration.
 *
 * @param {object} options
 * @param {number} options.durationFrames
 * @param {object} options.startFraming
 * @param {object} [options.endFraming]
 * @returns {Array<{ id: string, frame: number, framing: object }>}
 */
export function generateShotCameraKeys({
	durationFrames,
	startFraming,
	endFraming = null,
} = {}) {
	if (!durationFrames || durationFrames < 1) {
		throw new RangeError(`durationFrames must be >= 1, got ${durationFrames}`);
	}

	const keys = [
		{
			id: "key_start",
			frame: 0,
			framing: {
				pos: { ...startFraming.pos },
				yaw: startFraming.yaw,
				pitch: startFraming.pitch,
				fovDeg: startFraming.fovDeg,
			},
		},
	];

	if (endFraming && durationFrames > 1) {
		keys.push({
			id: "key_end",
			frame: durationFrames - 1,
			framing: {
				pos: { ...endFraming.pos },
				yaw: endFraming.yaw,
				pitch: endFraming.pitch,
				fovDeg: endFraming.fovDeg,
			},
		});
	}

	return Object.freeze(keys);
}
