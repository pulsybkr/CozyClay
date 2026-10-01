// Canonical JSON, validation and limits for the CozyStory v1 remote source contract.
// Pure ECMAScript (browser and Node compatible, no node-only module imports).

export const SOURCE_SCHEMA_VERSION = "cozy-story-v1";

export const SOURCE_LIMITS = Object.freeze({
	maxDurationSeconds: 1200,
	maxFrames: 28800,
	maxCharacters: 32,
	maxSets: 32,
	maxScenes: 32,
	maxShots: 256,
	maxPageLimit: 100,
	defaultPageLimit: 50,
	maxSnapshotBytes: 8 * 1024 * 1024,
	maxPageBytes: 2 * 1024 * 1024,
});

export const SOURCE_SECTIONS = Object.freeze([
	"characters",
	"sets",
	"scenes",
	"shots",
	"actions",
	"narration",
]);

export const SOURCE_MODES = Object.freeze(["structured", "legacy", "mixed"]);
export const SOURCE_ASPECTS = Object.freeze(["9:16", "16:9"]);
export const RESOURCE_ROLES = Object.freeze([
	"avatar-vrm",
	"motion-npz",
	"narration-audio",
	"reference-image",
	"mesh",
]);

const ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * RFC 8785-compliant deterministic JSON canonicalization.
 * Sorts object keys recursively and formats primitives consistently.
 */
export function canonicalJson(value) {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(item => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
	}
	const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
	const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
	return `{${entries.join(",")}}`;
}

/**
 * Computes the SHA-256 hash formatted as "sha256:<hex64>".
 * Supports WebCrypto (subtle) available in modern browsers and Node.js.
 */
export async function computeCanonicalHash(value, subtle = globalThis.crypto?.subtle) {
	const json = canonicalJson(value);
	const bytes = new TextEncoder().encode(json);
	if (!subtle?.digest) {
		throw new Error("crypto.subtle is required to compute canonical hash.");
	}
	const digest = await subtle.digest("SHA-256", bytes);
	const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
	return `sha256:${hex}`;
}

/**
 * Computes canonical hash for a section list of items.
 */
export async function computeSectionHash(sectionName, items, subtle = globalThis.crypto?.subtle) {
	return computeCanonicalHash(items, subtle);
}

export class ValidationError extends Error {
	constructor(message, errors = []) {
		super(message);
		this.name = "ValidationError";
		this.errors = errors;
	}
}

function pushError(errors, path, code, message, extra = {}) {
	errors.push({ path, code, message, ...extra });
}

function isNonEmptyString(val) {
	return typeof val === "string" && val.trim().length > 0;
}

function isValidId(val) {
	return typeof val === "string" && ID_REGEX.test(val);
}

function isFiniteNumber(val) {
	return typeof val === "number" && Number.isFinite(val);
}

/**
 * Validates a CozyStory manifest.
 * @param {object} manifest
 * @returns {{ valid: boolean, errors: Array<{path: string, code: string, message: string}> }}
 */
export function validateManifest(manifest) {
	const errors = [];
	if (!manifest || typeof manifest !== "object") {
		return { valid: false, errors: [{ path: "/", code: "INVALID_ROOT", message: "Manifest must be an object." }] };
	}

	if (manifest.schemaVersion !== SOURCE_SCHEMA_VERSION) {
		pushError(errors, "/schemaVersion", "UNSUPPORTED_SCHEMA", `Expected ${SOURCE_SCHEMA_VERSION}, received ${manifest.schemaVersion}`);
	}
	if (!isValidId(manifest.projectId)) {
		pushError(errors, "/projectId", "INVALID_ID", "projectId must match [A-Za-z0-9_-]{1,128}");
	}
	if (!isValidId(manifest.revision)) {
		pushError(errors, "/revision", "INVALID_REVISION", "revision must match [A-Za-z0-9_-]{1,128}");
	}
	if (manifest.manifestHash && (!manifest.manifestHash.startsWith("sha256:") || manifest.manifestHash.length !== 71)) {
		pushError(errors, "/manifestHash", "INVALID_HASH", "manifestHash must be in format sha256:<64-hex>");
	}
	if (!isNonEmptyString(manifest.title)) {
		pushError(errors, "/title", "MISSING_FIELD", "title is required");
	}
	if (manifest.sourceMode && !SOURCE_MODES.includes(manifest.sourceMode)) {
		pushError(errors, "/sourceMode", "INVALID_VARIANT", `sourceMode must be one of: ${SOURCE_MODES.join(", ")}`);
	}

	if (manifest.project) {
		const { fps, aspect, durationSeconds } = manifest.project;
		if (fps !== undefined && (!Number.isInteger(fps) || fps <= 0)) {
			pushError(errors, "/project/fps", "INVALID_VALUE", "fps must be a positive integer");
		}
		if (aspect !== undefined && !SOURCE_ASPECTS.includes(aspect)) {
			pushError(errors, "/project/aspect", "INVALID_VARIANT", `aspect must be one of: ${SOURCE_ASPECTS.join(", ")}`);
		}
		if (durationSeconds !== undefined) {
			if (!isFiniteNumber(durationSeconds) || durationSeconds <= 0 || durationSeconds > SOURCE_LIMITS.maxDurationSeconds) {
				pushError(errors, "/project/durationSeconds", "OUT_OF_BOUNDS", `durationSeconds must be in (0, ${SOURCE_LIMITS.maxDurationSeconds}]`);
			}
		}
	} else {
		pushError(errors, "/project", "MISSING_FIELD", "project specification is required");
	}

	if (!Array.isArray(manifest.sections)) {
		pushError(errors, "/sections", "MISSING_FIELD", "sections array is required");
	} else {
		const seenSections = new Set();
		manifest.sections.forEach((sec, idx) => {
			const prefix = `/sections/${idx}`;
			if (!sec || typeof sec !== "object") {
				pushError(errors, prefix, "INVALID_ENTRY", "Section entry must be an object");
				return;
			}
			if (!SOURCE_SECTIONS.includes(sec.name)) {
				pushError(errors, `${prefix}/name`, "UNKNOWN_SECTION", `Unknown section ${sec.name}`);
			} else if (seenSections.has(sec.name)) {
				pushError(errors, `${prefix}/name`, "DUPLICATE_SECTION", `Duplicate section declaration ${sec.name}`);
			} else {
				seenSections.add(sec.name);
			}
			if (!Number.isInteger(sec.count) || sec.count < 0) {
				pushError(errors, `${prefix}/count`, "INVALID_VALUE", "Section count must be a non-negative integer");
			}
			if (!Array.isArray(sec.ids)) {
				pushError(errors, `${prefix}/ids`, "INVALID_VALUE", "Section ids must be an array");
			} else if (sec.count !== undefined && sec.ids.length !== sec.count) {
				pushError(errors, `${prefix}/ids`, "COUNT_MISMATCH", `ids length (${sec.ids.length}) does not match count (${sec.count})`);
			}
			if (sec.hash && (!sec.hash.startsWith("sha256:") || sec.hash.length !== 71)) {
				pushError(errors, `${prefix}/hash`, "INVALID_HASH", "hash must be format sha256:<64-hex>");
			}
		});
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validates a paginated section response.
 */
export function validateSectionPage(page, expectedSection = null) {
	const errors = [];
	if (!page || typeof page !== "object") {
		return { valid: false, errors: [{ path: "/", code: "INVALID_ROOT", message: "Section page must be an object." }] };
	}

	if (page.schemaVersion !== SOURCE_SCHEMA_VERSION) {
		pushError(errors, "/schemaVersion", "UNSUPPORTED_SCHEMA", `Expected ${SOURCE_SCHEMA_VERSION}, received ${page.schemaVersion}`);
	}
	if (!isValidId(page.projectId)) {
		pushError(errors, "/projectId", "INVALID_ID", "projectId must match [A-Za-z0-9_-]{1,128}");
	}
	if (!isValidId(page.revision)) {
		pushError(errors, "/revision", "INVALID_REVISION", "revision must match [A-Za-z0-9_-]{1,128}");
	}
	if (!SOURCE_SECTIONS.includes(page.section)) {
		pushError(errors, "/section", "UNKNOWN_SECTION", `section must be one of: ${SOURCE_SECTIONS.join(", ")}`);
	} else if (expectedSection && page.section !== expectedSection) {
		pushError(errors, "/section", "SECTION_MISMATCH", `Expected section ${expectedSection}, received ${page.section}`);
	}
	if (!Array.isArray(page.items)) {
		pushError(errors, "/items", "INVALID_VALUE", "items must be an array");
	} else if (page.items.length > SOURCE_LIMITS.maxPageLimit) {
		pushError(errors, "/items", "PAGE_TOO_LARGE", `Page items (${page.items.length}) exceed maximum limit (${SOURCE_LIMITS.maxPageLimit})`);
	}
	if (!Number.isInteger(page.total) || page.total < 0) {
		pushError(errors, "/total", "INVALID_VALUE", "total must be a non-negative integer");
	}
	if (page.nextCursor !== null && typeof page.nextCursor !== "string") {
		pushError(errors, "/nextCursor", "INVALID_VALUE", "nextCursor must be a string or null");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validates a complete Story snapshot (with all sections and cross-references).
 */
export function validateSnapshot(snapshot) {
	const errors = [];
	if (!snapshot || typeof snapshot !== "object") {
		return { valid: false, errors: [{ path: "/", code: "INVALID_ROOT", message: "Snapshot must be an object." }] };
	}

	if (snapshot.schemaVersion !== SOURCE_SCHEMA_VERSION) {
		pushError(errors, "/schemaVersion", "UNSUPPORTED_SCHEMA", `Expected ${SOURCE_SCHEMA_VERSION}`);
	}
	if (!isValidId(snapshot.projectId)) {
		pushError(errors, "/projectId", "INVALID_ID", "projectId must match [A-Za-z0-9_-]{1,128}");
	}
	if (!isValidId(snapshot.revision)) {
		pushError(errors, "/revision", "INVALID_REVISION", "revision must match [A-Za-z0-9_-]{1,128}");
	}
	if (!isNonEmptyString(snapshot.title)) {
		pushError(errors, "/title", "MISSING_FIELD", "title is required");
	}

	// Project limits
	const project = snapshot.project;
	let duration = 0;
	if (!project || typeof project !== "object") {
		pushError(errors, "/project", "MISSING_FIELD", "project configuration is required");
	} else {
		duration = project.durationSeconds ?? 0;
		if (!isFiniteNumber(duration) || duration <= 0 || duration > SOURCE_LIMITS.maxDurationSeconds) {
			pushError(errors, "/project/durationSeconds", "OUT_OF_BOUNDS", `durationSeconds must be in (0, ${SOURCE_LIMITS.maxDurationSeconds}]`);
		}
		if (project.aspect && !SOURCE_ASPECTS.includes(project.aspect)) {
			pushError(errors, "/project/aspect", "INVALID_VARIANT", `aspect must be one of: ${SOURCE_ASPECTS.join(", ")}`);
		}
	}

	// Collections
	const characterIds = new Set();
	const setIds = new Set();
	const propIdsBySet = new Map();
	const sceneIds = new Set();
	const shotIds = new Set();
	const actionIds = new Set();

	// 1. Characters
	const characters = snapshot.characters ?? [];
	if (!Array.isArray(characters)) {
		pushError(errors, "/characters", "INVALID_VALUE", "characters must be an array");
	} else {
		if (characters.length > SOURCE_LIMITS.maxCharacters) {
			pushError(errors, "/characters", "LIMIT_EXCEEDED", `Character count ${characters.length} exceeds limit ${SOURCE_LIMITS.maxCharacters}`);
		}
		characters.forEach((char, idx) => {
			const p = `/characters/${idx}`;
			if (!isValidId(char.id)) pushError(errors, `${p}/id`, "INVALID_ID", "Invalid character ID");
			else if (characterIds.has(char.id)) pushError(errors, `${p}/id`, "DUPLICATE_ID", `Duplicate character ID: ${char.id}`);
			else characterIds.add(char.id);

			if (!isNonEmptyString(char.name)) pushError(errors, `${p}/name`, "MISSING_FIELD", "Character name is required");
			if (char.heightMeters != null && (!isFiniteNumber(char.heightMeters) || char.heightMeters <= 0.2 || char.heightMeters > 3.0)) {
				pushError(errors, `${p}/heightMeters`, "OUT_OF_BOUNDS", "heightMeters must be between 0.2m and 3.0m");
			}
		});
	}

	// 2. Sets and Props
	const sets = snapshot.sets ?? [];
	if (!Array.isArray(sets)) {
		pushError(errors, "/sets", "INVALID_VALUE", "sets must be an array");
	} else {
		if (sets.length > SOURCE_LIMITS.maxSets) {
			pushError(errors, "/sets", "LIMIT_EXCEEDED", `Set count ${sets.length} exceeds limit ${SOURCE_LIMITS.maxSets}`);
		}
		sets.forEach((set, idx) => {
			const p = `/sets/${idx}`;
			if (!isValidId(set.id)) pushError(errors, `${p}/id`, "INVALID_ID", "Invalid set ID");
			else if (setIds.has(set.id)) pushError(errors, `${p}/id`, "DUPLICATE_ID", `Duplicate set ID: ${set.id}`);
			else setIds.add(set.id);

			const propsInSet = new Set();
			if (Array.isArray(set.props)) {
				set.props.forEach((prop, pIdx) => {
					const pp = `${p}/props/${pIdx}`;
					if (!isValidId(prop.id)) pushError(errors, `${pp}/id`, "INVALID_ID", "Invalid prop ID");
					else if (propsInSet.has(prop.id)) pushError(errors, `${pp}/id`, "DUPLICATE_ID", `Duplicate prop ID in set: ${prop.id}`);
					else propsInSet.add(prop.id);

					if (prop.heightMeters != null && (!isFiniteNumber(prop.heightMeters) || prop.heightMeters <= 0)) {
						pushError(errors, `${pp}/heightMeters`, "OUT_OF_BOUNDS", "prop heightMeters must be positive");
					}
				});
			}
			propIdsBySet.set(set.id, propsInSet);
		});
	}

	// 3. Scenes
	const scenes = snapshot.scenes ?? [];
	const sceneSetMap = new Map();
	if (!Array.isArray(scenes)) {
		pushError(errors, "/scenes", "INVALID_VALUE", "scenes must be an array");
	} else {
		if (scenes.length > SOURCE_LIMITS.maxScenes) {
			pushError(errors, "/scenes", "LIMIT_EXCEEDED", `Scene count ${scenes.length} exceeds limit ${SOURCE_LIMITS.maxScenes}`);
		}
		let lastEnd = 0;
		scenes.forEach((sc, idx) => {
			const p = `/scenes/${idx}`;
			if (!isValidId(sc.id)) pushError(errors, `${p}/id`, "INVALID_ID", "Invalid scene ID");
			else if (sceneIds.has(sc.id)) pushError(errors, `${p}/id`, "DUPLICATE_ID", `Duplicate scene ID: ${sc.id}`);
			else sceneIds.add(sc.id);

			if (!setIds.has(sc.setId)) {
				pushError(errors, `${p}/setId`, "SOURCE_REFERENCE_MISSING", `Scene references unknown setId: ${sc.setId}`);
			} else {
				sceneSetMap.set(sc.id, sc.setId);
			}

			const start = sc.globalStartSeconds;
			const end = sc.globalEndSeconds;
			if (!isFiniteNumber(start) || start < 0) pushError(errors, `${p}/globalStartSeconds`, "INVALID_TIME", "globalStartSeconds must be >= 0");
			if (!isFiniteNumber(end) || end <= start) pushError(errors, `${p}/globalEndSeconds`, "INVALID_TIME", "globalEndSeconds must be > start");
			if (start < lastEnd) {
				pushError(errors, `${p}/globalStartSeconds`, "TIME_OVERLAP", `Scene overlaps previous scene ending at ${lastEnd}`);
			}
			if (end > duration && duration > 0) {
				pushError(errors, `${p}/globalEndSeconds`, "OUT_OF_BOUNDS", `Scene end ${end}s exceeds project duration ${duration}s`);
			}
			lastEnd = end;

			if (Array.isArray(sc.cast)) {
				sc.cast.forEach((c, cIdx) => {
					if (!characterIds.has(c.characterId)) {
						pushError(errors, `${p}/cast/${cIdx}/characterId`, "SOURCE_REFERENCE_MISSING", `Cast references unknown characterId: ${c.characterId}`);
					}
				});
			}
		});
	}

	// 4. Shots
	const shots = snapshot.shots ?? [];
	if (!Array.isArray(shots)) {
		pushError(errors, "/shots", "INVALID_VALUE", "shots must be an array");
	} else {
		if (shots.length > SOURCE_LIMITS.maxShots) {
			pushError(errors, "/shots", "LIMIT_EXCEEDED", `Shot count ${shots.length} exceeds limit ${SOURCE_LIMITS.maxShots}`);
		}
		const shotsByScene = new Map();
		shots.forEach((sh, idx) => {
			const p = `/shots/${idx}`;
			if (!isValidId(sh.id)) pushError(errors, `${p}/id`, "INVALID_ID", "Invalid shot ID");
			else if (shotIds.has(sh.id)) pushError(errors, `${p}/id`, "DUPLICATE_ID", `Duplicate shot ID: ${sh.id}`);
			else shotIds.add(sh.id);

			if (!sceneIds.has(sh.sceneId)) {
				pushError(errors, `${p}/sceneId`, "SOURCE_REFERENCE_MISSING", `Shot references unknown sceneId: ${sh.sceneId}`);
			}

			const start = sh.startSeconds;
			const end = sh.endSeconds;
			if (!isFiniteNumber(start) || start < 0) pushError(errors, `${p}/startSeconds`, "INVALID_TIME", "startSeconds must be >= 0");
			if (!isFiniteNumber(end) || end <= start) pushError(errors, `${p}/endSeconds`, "INVALID_TIME", "endSeconds must be > start");

			if (sh.camera?.targets) {
				const setId = sceneSetMap.get(sh.sceneId);
				const availableProps = setId ? propIdsBySet.get(setId) : null;
				sh.camera.targets.forEach((tgt, tIdx) => {
					const isChar = characterIds.has(tgt);
					const isProp = availableProps?.has(tgt);
					if (!isChar && !isProp) {
						pushError(errors, `${p}/camera/targets/${tIdx}`, "SOURCE_REFERENCE_MISSING", `Target ${tgt} not found in characters or scene set props`, { targetId: tgt });
					}
				});
			}

			if (sh.sceneId) {
				const list = shotsByScene.get(sh.sceneId) ?? [];
				list.push(sh);
				shotsByScene.set(sh.sceneId, list);
			}
		});

		// Check contiguous shots per scene
		for (const [sId, sShots] of shotsByScene.entries()) {
			sShots.sort((a, b) => a.startSeconds - b.startSeconds);
			let cursor = 0;
			sShots.forEach((sh, i) => {
				if (Math.abs(sh.startSeconds - cursor) > 1e-3) {
					pushError(errors, `/shots/${sh.id}/startSeconds`, "SHOT_GAP_OR_OVERLAP", `Shot ${sh.id} starts at ${sh.startSeconds}s, expected contiguous cut at ${cursor}s in scene ${sId}`);
				}
				cursor = sh.endSeconds;
			});
		}
	}

	// 5. Actions (body, interaction, expression)
	const actions = snapshot.actions ?? [];
	if (!Array.isArray(actions)) {
		pushError(errors, "/actions", "INVALID_VALUE", "actions must be an array");
	} else {
		actions.forEach((act, idx) => {
			const p = `/actions/${idx}`;
			if (!isValidId(act.id)) pushError(errors, `${p}/id`, "INVALID_ID", "Invalid action ID");
			else if (actionIds.has(act.id)) pushError(errors, `${p}/id`, "DUPLICATE_ID", `Duplicate action ID: ${act.id}`);
			else actionIds.add(act.id);

			if (act.sceneId && !sceneIds.has(act.sceneId)) {
				pushError(errors, `${p}/sceneId`, "SOURCE_REFERENCE_MISSING", `Action references unknown sceneId: ${act.sceneId}`);
			}
			if (act.characterId && !characterIds.has(act.characterId)) {
				pushError(errors, `${p}/characterId`, "SOURCE_REFERENCE_MISSING", `Action references unknown characterId: ${act.characterId}`);
			}
			if (act.kind === "interaction" && act.objectId) {
				const setId = sceneSetMap.get(act.sceneId);
				const availableProps = setId ? propIdsBySet.get(setId) : null;
				if (!availableProps || !availableProps.has(act.objectId)) {
					pushError(errors, `${p}/objectId`, "SOURCE_REFERENCE_MISSING", `Interaction references unknown objectId: ${act.objectId} in set ${setId}`);
				}
			}
		});
	}

	// 6. Separate expressions array (if provided in snapshot)
	if (Array.isArray(snapshot.expressions)) {
		snapshot.expressions.forEach((expr, idx) => {
			const p = `/expressions/${idx}`;
			if (!isValidId(expr.id)) pushError(errors, `${p}/id`, "INVALID_ID", "Invalid expression ID");
			else if (actionIds.has(expr.id)) pushError(errors, `${p}/id`, "DUPLICATE_ID", `Duplicate expression/action ID: ${expr.id}`);
			else actionIds.add(expr.id);

			if (expr.sceneId && !sceneIds.has(expr.sceneId)) pushError(errors, `${p}/sceneId`, "SOURCE_REFERENCE_MISSING", `Expression references unknown sceneId: ${expr.sceneId}`);
			if (expr.characterId && !characterIds.has(expr.characterId)) pushError(errors, `${p}/characterId`, "SOURCE_REFERENCE_MISSING", `Expression references unknown characterId: ${expr.characterId}`);
		});
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Asserts that a snapshot is valid or throws ValidationError with detailed errors.
 */
export function assertValidSnapshot(snapshot) {
	const res = validateSnapshot(snapshot);
	if (!res.valid) {
		const first = res.errors[0];
		throw new ValidationError(`Snapshot validation failed: ${first.message} at ${first.path}`, res.errors);
	}
	return snapshot;
}
