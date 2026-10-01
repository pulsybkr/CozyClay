// ProductionDocument and Plan contract schemas and validation.
// Pure ECMAScript (browser and Node compatible).

export const PLAN_SCHEMA_VERSION = 1;

export const PRODUCTION_UNIT_KINDS = Object.freeze([
	"scene",
	"structure",
	"asset",
	"avatar",
	"cast-instance",
	"shot",
	"motion-clip",
	"motion-compose",
	"expressions",
	"interaction",
	"verify",
	"export",
]);

export const UNIT_REVIEW_STATES = Object.freeze(["ready", "needs-input", "unsupported"]);

export const UNIT_RUN_STATES = Object.freeze([
	"pending",
	"blocked",
	"ready",
	"running",
	"waiting-provider",
	"artifact-ready",
	"installing",
	"verified",
	"done",
	"failed",
	"uncertain",
	"stale",
]);

export const NATIVE_ENTITY_KINDS = Object.freeze(["scene", "object", "character", "shot", "camera"]);

function pushError(errors, path, code, message, extra = {}) {
	errors.push({ path, code, message, ...extra });
}

function isNonEmptyString(val) {
	return typeof val === "string" && val.trim().length > 0;
}

/**
 * Validates a single compiled ProductionUnit.
 */
export function validateProductionUnit(unit, pathPrefix = "/plan/units") {
	const errors = [];
	if (!unit || typeof unit !== "object") {
		return { valid: false, errors: [{ path: pathPrefix, code: "INVALID_UNIT", message: "Unit must be an object" }] };
	}

	if (!isNonEmptyString(unit.id)) pushError(errors, `${pathPrefix}/id`, "MISSING_ID", "Unit id is required");
	if (!PRODUCTION_UNIT_KINDS.includes(unit.kind)) {
		pushError(errors, `${pathPrefix}/kind`, "INVALID_KIND", `Unit kind must be one of: ${PRODUCTION_UNIT_KINDS.join(", ")}`);
	}
	if (!Array.isArray(unit.sourceRefs)) pushError(errors, `${pathPrefix}/sourceRefs`, "INVALID_VALUE", "sourceRefs must be an array");
	if (!Array.isArray(unit.dependsOn)) pushError(errors, `${pathPrefix}/dependsOn`, "INVALID_VALUE", "dependsOn must be an array");
	if (!isNonEmptyString(unit.inputHash)) pushError(errors, `${pathPrefix}/inputHash`, "MISSING_HASH", "inputHash is required");
	if (unit.review && !UNIT_REVIEW_STATES.includes(unit.review)) {
		pushError(errors, `${pathPrefix}/review`, "INVALID_VARIANT", `review must be one of: ${UNIT_REVIEW_STATES.join(", ")}`);
	}
	if (!unit.payload || typeof unit.payload !== "object") {
		pushError(errors, `${pathPrefix}/payload`, "MISSING_PAYLOAD", "Unit payload object is required");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validates a SequenceEntry (timeline frame mapping per shot).
 */
export function validateSequenceEntry(entry, pathPrefix = "/plan/sequence") {
	const errors = [];
	if (!entry || typeof entry !== "object") {
		return { valid: false, errors: [{ path: pathPrefix, code: "INVALID_ENTRY", message: "SequenceEntry must be an object" }] };
	}

	if (!isNonEmptyString(entry.shotId)) pushError(errors, `${pathPrefix}/shotId`, "MISSING_FIELD", "shotId is required");
	if (!isNonEmptyString(entry.sceneId)) pushError(errors, `${pathPrefix}/sceneId`, "MISSING_FIELD", "sceneId is required");
	if (!Number.isInteger(entry.globalStartFrame) || entry.globalStartFrame < 0) {
		pushError(errors, `${pathPrefix}/globalStartFrame`, "INVALID_FRAME", "globalStartFrame must be non-negative integer");
	}
	if (!Number.isInteger(entry.globalEndFrameExclusive) || entry.globalEndFrameExclusive <= entry.globalStartFrame) {
		pushError(errors, `${pathPrefix}/globalEndFrameExclusive`, "INVALID_FRAME", "globalEndFrameExclusive must be greater than startFrame");
	}
	if (!Number.isInteger(entry.sceneStartFrame) || entry.sceneStartFrame < 0) {
		pushError(errors, `${pathPrefix}/sceneStartFrame`, "INVALID_FRAME", "sceneStartFrame must be non-negative integer");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Validates an EntityBinding between a source element and a native scene element.
 */
export function validateEntityBinding(binding, sourceId = "") {
	const errors = [];
	const prefix = `/bindings/${sourceId}`;
	if (!binding || typeof binding !== "object") {
		return { valid: false, errors: [{ path: prefix, code: "INVALID_BINDING", message: "Binding must be an object" }] };
	}

	if (!isNonEmptyString(binding.sourceId)) pushError(errors, `${prefix}/sourceId`, "MISSING_FIELD", "sourceId is required");
	if (!isNonEmptyString(binding.nativeSceneId)) pushError(errors, `${prefix}/nativeSceneId`, "MISSING_FIELD", "nativeSceneId is required");
	if (!isNonEmptyString(binding.nativeEntityId)) pushError(errors, `${prefix}/nativeEntityId`, "MISSING_FIELD", "nativeEntityId is required");
	if (!NATIVE_ENTITY_KINDS.includes(binding.nativeKind)) {
		pushError(errors, `${prefix}/nativeKind`, "INVALID_KIND", `nativeKind must be one of: ${NATIVE_ENTITY_KINDS.join(", ")}`);
	}
	if (!isNonEmptyString(binding.installedInputHash)) pushError(errors, `${prefix}/installedInputHash`, "MISSING_HASH", "installedInputHash is required");

	return { valid: errors.length === 0, errors };
}

/**
 * Validates a full ProductionDocument (local persisted model).
 */
export function validateProductionDocument(doc) {
	const errors = [];
	if (!doc || typeof doc !== "object") {
		return { valid: false, errors: [{ path: "/", code: "INVALID_ROOT", message: "ProductionDocument must be an object." }] };
	}

	if (doc.version !== PLAN_SCHEMA_VERSION) {
		pushError(errors, "/version", "UNSUPPORTED_VERSION", `Expected version ${PLAN_SCHEMA_VERSION}, received ${doc.version}`);
	}
	if (!isNonEmptyString(doc.productionId)) {
		pushError(errors, "/productionId", "MISSING_FIELD", "productionId is required");
	}

	// Source tracking
	if (!doc.source || typeof doc.source !== "object") {
		if (doc.source !== null || doc.plan?.units?.length) pushError(errors, "/source", "MISSING_FIELD", "source object is required for a compiled production");
	} else {
		if (!isNonEmptyString(doc.source.projectId)) pushError(errors, "/source/projectId", "MISSING_FIELD", "projectId is required");
		if (!isNonEmptyString(doc.source.revision)) pushError(errors, "/source/revision", "MISSING_FIELD", "revision is required");
		if (doc.source.fetchedSections && typeof doc.source.fetchedSections !== "object") {
			pushError(errors, "/source/fetchedSections", "INVALID_VALUE", "fetchedSections must be an object map");
		}
	}

	if (!Number.isInteger(doc.planRevision) || doc.planRevision < 0) {
		pushError(errors, "/planRevision", "INVALID_VALUE", "planRevision must be a non-negative integer");
	}

	// Plan structure
	if (!doc.plan || typeof doc.plan !== "object") {
		pushError(errors, "/plan", "MISSING_FIELD", "plan object is required");
	} else {
		const { fps, aspect, frameCount, units, sequence } = doc.plan;
		if (fps !== undefined && (!Number.isInteger(fps) || fps <= 0)) {
			pushError(errors, "/plan/fps", "INVALID_VALUE", "fps must be a positive integer");
		}
		if (aspect !== undefined && !["9:16", "16:9"].includes(aspect)) {
			pushError(errors, "/plan/aspect", "INVALID_VARIANT", "aspect must be 9:16 or 16:9");
		}
		if (frameCount !== undefined && (!Number.isInteger(frameCount) || frameCount < 0 || (frameCount === 0 && units?.length > 0))) {
			pushError(errors, "/plan/frameCount", "INVALID_VALUE", "frameCount must be positive integer");
		}

		if (Array.isArray(units)) {
			const unitIds = new Set();
			units.forEach((unit, idx) => {
				const res = validateProductionUnit(unit, `/plan/units/${idx}`);
				if (!res.valid) errors.push(...res.errors);
				if (unit.id) {
					if (unitIds.has(unit.id)) pushError(errors, `/plan/units/${idx}/id`, "DUPLICATE_ID", `Duplicate unit ID: ${unit.id}`);
					unitIds.add(unit.id);
				}
			});
		} else {
			pushError(errors, "/plan/units", "INVALID_VALUE", "units must be an array");
		}

		if (Array.isArray(sequence)) {
			sequence.forEach((entry, idx) => {
				const res = validateSequenceEntry(entry, `/plan/sequence/${idx}`);
				if (!res.valid) errors.push(...res.errors);
			});
		} else {
			pushError(errors, "/plan/sequence", "INVALID_VALUE", "sequence must be an array");
		}
	}

	// Bindings
	if (doc.bindings && typeof doc.bindings === "object") {
		for (const [sId, binding] of Object.entries(doc.bindings)) {
			const res = validateEntityBinding(binding, sId);
			if (!res.valid) errors.push(...res.errors);
		}
	}

	// Execution checkpoint
	if (doc.executionCheckpoint) {
		if (typeof doc.executionCheckpoint !== "object") {
			pushError(errors, "/executionCheckpoint", "INVALID_VALUE", "executionCheckpoint must be an object");
		} else if (doc.executionCheckpoint.units && !Array.isArray(doc.executionCheckpoint.units)) {
			pushError(errors, "/executionCheckpoint/units", "INVALID_VALUE", "executionCheckpoint.units must be an array");
		}
	}

	return { valid: errors.length === 0, errors };
}
