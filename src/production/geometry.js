/**
 * Metric spatial conventions, anchors, support surfaces and room geometry.
 *
 * Conforms to spec 05-compilation-3d:
 * - World convention: meters, +Y vertical, +Z forward, floor pivot at y = 0.
 * - Screen-space left is never converted to negative x without camera reference.
 * - Explicit furniture support levels: desk 0.75m -> prop rests on y = 0.75m.
 * - Anchors in local coordinates: supportTop, gripRight, gripLeft, seat.
 * - Segmented walls for openings/doors (no masked full walls).
 */

/**
 * Standard anchor names recognized across the 3D pipeline.
 */
export const ANCHOR_NAMES = Object.freeze(["supportTop", "gripRight", "gripLeft", "seat"]);

/**
 * Calculate the world Y level of the support surface for an object.
 * @param {{ y?: number, height?: number, supportY?: number }} object
 * @returns {number}
 */
export function supportSurfaceY(object) {
	const baseY = Number(object?.y) || 0;
	if (Number.isFinite(object?.supportY)) {
		return baseY + Number(object.supportY);
	}
	const height = Number(object?.height) || 0;
	return baseY + (height > 0 ? height : 0);
}

/**
 * Derive local anchors for an object based on its dimensions and metadata.
 * @param {{ height?: number, footprint?: { width?: number, depth?: number }, supportY?: number }} object
 * @returns {{ supportTop: {x:number, y:number, z:number}, gripRight: {x:number, y:number, z:number}, gripLeft: {x:number, y:number, z:number}, seat: {x:number, y:number, z:number} }}
 */
export function anchorsForObject(object) {
	const height = Math.max(0.01, Number(object?.height) || 1);
	const width = Math.max(0.01, Number(object?.footprint?.width) || height);
	const depth = Math.max(0.01, Number(object?.footprint?.depth) || height);
	const supportY = Number.isFinite(object?.supportY) ? Number(object.supportY) : height;

	return Object.freeze({
		supportTop: Object.freeze({ x: 0, y: supportY, z: 0 }),
		gripRight: Object.freeze({ x: Math.min(0.2, width * 0.3), y: height * 0.5, z: 0 }),
		gripLeft: Object.freeze({ x: -Math.min(0.2, width * 0.3), y: height * 0.5, z: 0 }),
		seat: Object.freeze({ x: 0, y: Number.isFinite(object?.supportY) ? supportY : height * 0.45, z: 0 }),
	});
}

/**
 * Compute metric axis-aligned bounding box (AABB) for an object in world coordinates.
 * @param {{ x?: number, y?: number, z?: number, height?: number, footprint?: { width?: number, depth?: number } }} object
 * @returns {{ min: {x:number, y:number, z:number}, max: {x:number, y:number, z:number}, center: {x:number, y:number, z:number}, size: {x:number, y:number, z:number} }}
 */
export function computeWorldBounds(object) {
	const x = Number(object?.x) || 0;
	const y = Number(object?.y) || 0;
	const z = Number(object?.z) || 0;
	const height = Math.max(0.001, Number(object?.height) || 1);
	const width = Math.max(0.001, Number(object?.footprint?.width) || height);
	const depth = Math.max(0.001, Number(object?.footprint?.depth) || height);

	const halfW = width / 2;
	const halfD = depth / 2;

	return Object.freeze({
		min: Object.freeze({ x: x - halfW, y, z: z - halfD }),
		max: Object.freeze({ x: x + halfW, y: y + height, z: z + halfD }),
		center: Object.freeze({ x, y: y + height / 2, z }),
		size: Object.freeze({ x: width, y: height, z: depth }),
	});
}

/**
 * Place a prop resting on top of a support object (e.g. table, desk, shelf).
 * @param {object} prop
 * @param {object} support
 * @param {{ x?: number, z?: number }} [localOffset={}]
 * @returns {object} updated prop with calculated x, y, z
 */
export function placePropOnSupport(prop, support, localOffset = {}) {
	const restingY = supportSurfaceY(support);
	const x = (Number(support?.x) || 0) + (Number(localOffset?.x) || 0);
	const z = (Number(support?.z) || 0) + (Number(localOffset?.z) || 0);
	return {
		...prop,
		x,
		y: restingY,
		z,
	};
}

/**
 * Build explicit room structures (floor and segmented walls for openings).
 * Doors are formed by segmented walls leaving an opening, not by hiding a full wall.
 *
 * @param {object} options
 * @param {number} [options.width=6] Room width along X (meters)
 * @param {number} [options.depth=6] Room depth along Z (meters)
 * @param {number} [options.height=2.8] Ceiling height along Y (meters)
 * @param {number} [options.wallThickness=0.1]
 * @param {Array<{ wall: "north"|"south"|"east"|"west", offset: number, width: number, height: number }>} [options.openings=[]]
 * @returns {{ floor: object, walls: Array<object> }}
 */
export function createRoomPrimitiveSet({
	width = 6,
	depth = 6,
	height = 2.8,
	wallThickness = 0.1,
	openings = [],
} = {}) {
	const floor = Object.freeze({
		kind: "plane",
		label: "Floor",
		x: 0,
		y: 0,
		z: 0,
		footprint: { width, depth },
		height: 0,
		color: "#c2c6c8",
	});

	const walls = [];

	// North wall (along X, at z = -depth/2)
	// South wall (along X, at z = +depth/2)
	// East wall (along Z, at x = +width/2)
	// West wall (along Z, at x = -width/2)
	const wallsConfig = [
		{ side: "north", length: width, z: -depth / 2, x: 0, rot: 0 },
		{ side: "south", length: width, z: depth / 2, x: 0, rot: 0 },
		{ side: "east", length: depth, x: width / 2, z: 0, rot: 90 },
		{ side: "west", length: depth, x: -width / 2, z: 0, rot: 90 },
	];

	for (const config of wallsConfig) {
		const wallOpenings = openings.filter((op) => op.wall === config.side);
		if (!wallOpenings.length) {
			// Continuous wall
			walls.push(Object.freeze({
				kind: "cube",
				label: `Wall ${config.side}`,
				x: config.x,
				y: 0,
				z: config.z,
				rot: config.rot,
				footprint: { width: config.length, depth: wallThickness },
				height,
				color: "#d9d9d9",
			}));
		} else {
			// Segmented wall around openings
			const sorted = [...wallOpenings].sort((a, b) => a.offset - b.offset);
			let currentPos = -config.length / 2;

			for (let idx = 0; idx < sorted.length; idx++) {
				const op = sorted[idx];
				const openingStart = op.offset - op.width / 2;
				const openingEnd = op.offset + op.width / 2;

				// Left segment
				if (openingStart > currentPos) {
					const segWidth = openingStart - currentPos;
					const segCenter = currentPos + segWidth / 2;
					walls.push(Object.freeze({
						kind: "cube",
						label: `Wall ${config.side} segment ${idx * 2 + 1}`,
						x: config.rot === 0 ? segCenter : config.x,
						y: 0,
						z: config.rot === 0 ? config.z : segCenter,
						rot: config.rot,
						footprint: { width: segWidth, depth: wallThickness },
						height,
						color: "#d9d9d9",
					}));
				}

				// Header above door/window if opening height < room height
				if (op.height < height) {
					const headerHeight = height - op.height;
					walls.push(Object.freeze({
						kind: "cube",
						label: `Wall ${config.side} lintel ${idx + 1}`,
						x: config.rot === 0 ? op.offset : config.x,
						y: op.height,
						z: config.rot === 0 ? config.z : op.offset,
						rot: config.rot,
						footprint: { width: op.width, depth: wallThickness },
						height: headerHeight,
						color: "#d9d9d9",
					}));
				}

				currentPos = openingEnd;
			}

			// Final right segment
			if (currentPos < config.length / 2) {
				const segWidth = config.length / 2 - currentPos;
				const segCenter = currentPos + segWidth / 2;
				walls.push(Object.freeze({
					kind: "cube",
					label: `Wall ${config.side} end segment`,
					x: config.rot === 0 ? segCenter : config.x,
					y: 0,
					z: config.rot === 0 ? config.z : segCenter,
					rot: config.rot,
					footprint: { width: segWidth, depth: wallThickness },
					height,
					color: "#d9d9d9",
				}));
			}
		}
	}

	return Object.freeze({ floor, walls: Object.freeze(walls) });
}
