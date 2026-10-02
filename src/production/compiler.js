/**
 * Pure, deterministic production compilation from StorySnapshot into ProductionDocument.
 *
 * Conforms to spec 05-compilation-3d:
 * - Deterministic: NO network fetch, NO GPU calls.
 * - Canonical 24 fps time mapping.
 * - Metric spatial conventions with furniture support surfaces.
 * - Semantic camera framing with deg-to-rad angle conversion.
 * - Detects blocking ambiguities and emits explicit hypotheses and decisions.
 */

import { validateSnapshot, canonicalJson } from "./source-contract.js";
import { validateProductionDocument } from "./plan-contract.js";
import { CANONICAL_FPS, secondsToFrames, normalizeInterval } from "./normalize.js";
import { supportSurfaceY, computeWorldBounds, placePropOnSupport } from "./geometry.js";
import { planCameraFraming, degToRad, generateShotCameraKeys } from "./camera-planner.js";

/**
 * Generate a deterministic short hash from string input.
 */
function simpleHash(str) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) - hash) + str.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(16).padStart(8, "0");
}

function inputHashOf(val) {
	return simpleHash(canonicalJson(val));
}

/**
 * Deterministically compiles a validated StorySnapshot into a local ProductionDocument.
 *
 * @param {object} snapshot Distant story snapshot
 * @param {object} [overrides={}] Local user overrides
 * @param {object} [capabilities={}] Local engine capabilities
 * @returns {{ plan: object|null, hypotheses: Array<object>, decisions: Array<object>, errors: Array<object> }}
 */
export function compile(snapshot, overrides = {}, capabilities = {}) {
	const errors = [];
	const hypotheses = [];
	const decisions = [];

	if (!snapshot || typeof snapshot !== "object") {
		return {
			plan: null,
			hypotheses: [],
			decisions: [],
			errors: [{ path: "/", code: "INVALID_SNAPSHOT", message: "Snapshot must be an object", fatal: true }],
		};
	}

	// Step 1: Validate input source snapshot
	snapshot = structuredClone(snapshot);
 if (Array.isArray(overrides)) {
  for (const op of overrides) {
   const targetId = op.sourceId || op.targetId || op.id;
   const prop = (snapshot.sets || []).flatMap(s => s.props || []).find(p => p.id === targetId);
   const action = (snapshot.actions || []).find(a => a.id === targetId);
   const shot = (snapshot.shots || []).find(s => s.id === targetId);
   const character = (snapshot.characters || []).find(ch => ch.id === targetId);
   const cast = (snapshot.scenes || []).filter(s => !op.sceneId || s.id === op.sceneId).flatMap(s => s.cast || []).find(ch => ch.characterId === targetId);
   if (op.op === "set-prop-height" && prop) prop.heightMeters = op.heightMeters ?? op.value;
   else if (op.op === "set-placement" && prop) prop.positionMeters = op.positionMeters || op.value;
   else if (op.op === "set-placement" && cast) cast.positionMeters = op.positionMeters || op.value;
   else if (op.op === "choose-resource" && character && op.strategy === "builtin") character.avatar = { strategy: "builtin" };
   else if (op.op === "choose-resource" && prop && op.strategy === "procedural") { prop.acquisition = { strategy: "procedural" }; prop.kind = op.kind || "cube"; }
   else if (op.op === "choose-resource" && prop && op.strategy === "library" && op.query) prop.acquisition = { strategy: "library", query: op.query, ...(op.modelId ? { modelId: op.modelId } : {}) };
   else if (op.op === "assign-action-actor" && action) action.characterId = op.characterId;
   else if (op.op === "set-action-window" && action) { action.startSeconds = op.startSeconds; action.endSeconds = op.endSeconds; }
   else if (op.op === "set-camera-intent" && shot) shot.camera = { ...shot.camera, ...(op.camera || op.value) };
   else errors.push({ code: "UNSUPPORTED_OVERRIDE", message: "Cannot apply draft operation " + op.op + " to " + targetId, fatal: true });
  }
 }
 const sourceValidation = validateSnapshot(snapshot);
	if (!sourceValidation.valid) {
		for (const err of sourceValidation.errors) {
			errors.push({ ...err, fatal: true });
		}
		return { plan: null, hypotheses: [], decisions: [], errors };
	}

	const fps = snapshot.project?.fps || CANONICAL_FPS;
	const aspect = snapshot.project?.aspect || "9:16";

	// Maps for fast reference lookup
	const characterMap = new Map((snapshot.characters ?? []).map((c) => [c.id, c]));
	const setMap = new Map((snapshot.sets ?? []).map((s) => [s.id, s]));

	// Step 2: Validate scenes and actors
	const scenes = Array.isArray(snapshot.scenes) ? snapshot.scenes : [];
	if (!scenes.length) {
		errors.push({ path: "/scenes", code: "EMPTY_SCENES", message: "Snapshot contains no scenes", fatal: true });
	}

	let globalPlayhead = 0;
	const sequence = [];
	const compiledScenes = [];
	const sceneUnits = [];
	const structUnits = [];
	const shotUnits = [];

	// Track characters and actions for conflict checks
	// V2 facial directives are planned motion, while keyed expressions retain
	// the existing native expression track path (including all V1 expressions).
	const isExpressionTrack = action =>
		(action.kind === "expression" && (snapshot.schemaVersion !== "cozy-story-v2" || action.keys?.length > 0)) ||
		(action.keys && !action.kind);
	const actions = Array.isArray(snapshot.actions) ? snapshot.actions.filter(a => !isExpressionTrack(a)) : [];
 const expressions = [...(snapshot.expressions || []), ...(snapshot.actions || []).filter(isExpressionTrack)];
	const bodyActionIntervals = new Map(); // key: characterId -> array of { actionId, sceneId, startFrame, endFrameExclusive }

	for (const action of actions) {
		if (action.characterId && !characterMap.has(action.characterId)) {
			errors.push({
				path: `/actions/${action.id}/characterId`,
				code: "UNKNOWN_ACTOR",
				message: `Action ${action.id} references unknown character: ${action.characterId}`,
				fatal: true,
			});
		}

		if (action.kind === "body" && action.characterId) {
			let startFrame;
			let endFrameExclusive;
			try {
				const interval = normalizeInterval(action.startSeconds, action.endSeconds, fps);
				startFrame = interval.startFrame;
				endFrameExclusive = interval.endFrameExclusive;
			} catch (err) {
				errors.push({
					path: `/actions/${action.id}`,
					code: "INVALID_TIMING",
					message: `Action ${action.id} has invalid timing: ${err.message}`,
					fatal: true,
				});
				continue;
			}

			const charActions = bodyActionIntervals.get(action.characterId) ?? [];
			for (const existing of charActions) {
				if (existing.sceneId === action.sceneId) {
					// Check interval overlap: [A, B) and [C, D) overlap if max(A, C) < min(B, D)
					if (Math.max(existing.startFrame, startFrame) < Math.min(existing.endFrameExclusive, endFrameExclusive)) {
						errors.push({
							path: `/actions/${action.id}`,
							code: "CONFLICTING_ACTIONS",
							message: `Actor ${action.characterId} has simultaneous conflicting body actions: ${existing.actionId} and ${action.id}`,
							fatal: true,
						});
					}
				}
			}
			charActions.push({ actionId: action.id, sceneId: action.sceneId, startFrame, endFrameExclusive });
			bodyActionIntervals.set(action.characterId, charActions);
		}
	}

	// Step 3: Process scenes, sets, props, shots, cameras
	for (let scIdx = 0; scIdx < scenes.length; scIdx++) {
		const scene = scenes[scIdx];
		const sceneSet = setMap.get(scene.setId);

		if (!sceneSet) {
			errors.push({
				path: `/scenes/${scene.id}/setId`,
				code: "UNKNOWN_SET",
				message: `Scene ${scene.id} references unknown set: ${scene.setId}`,
				fatal: true,
			});
		}

		let sceneDurationFrames;
		try {
			const interval = normalizeInterval(scene.globalStartSeconds ?? 0, scene.globalEndSeconds ?? 12, fps);
			sceneDurationFrames = interval.durationFrames;
		} catch (err) {
			errors.push({
				path: `/scenes/${scene.id}`,
				code: "INVALID_SCENE_TIMING",
				message: `Scene ${scene.id} has invalid timing: ${err.message}`,
				fatal: true,
			});
			sceneDurationFrames = 24 * 12;
		}

		const sceneGlobalStart = globalPlayhead;
		const sceneGlobalEnd = sceneGlobalStart + sceneDurationFrames;

		// Process Props in the Scene Set
		const compiledProps = [];
		const propPosMap = new Map();

		if (sceneSet && Array.isArray(sceneSet.props)) {
			// First pass: props without support
			for (const prop of sceneSet.props) {
				if (!prop.support) {
					const pos = {
						x: Number(prop.positionMeters?.x) || 0,
						y: Number(prop.positionMeters?.y) || 0,
						z: Number(prop.positionMeters?.z) || 0,
					};
					const height = prop.heightMeters ?? prop.height ?? 1;
					propPosMap.set(prop.id, { ...prop, ...pos, height });
					compiledProps.push({
						id: prop.id,
						name: prop.name,
						x: pos.x,
						y: pos.y,
						z: pos.z,
						height,
						kind: prop.kind || "cube",
						rot: prop.yawDegrees ?? 0,
						acquisition: prop.acquisition || null,
						footprint: { width: prop.dimensionsMeters?.x ?? prop.dimensionsMeters?.width ?? prop.footprint?.width ?? height, depth: prop.dimensionsMeters?.z ?? prop.dimensionsMeters?.depth ?? prop.footprint?.depth ?? height },
					});
				}
			}

			// Second pass: props with support
			for (const prop of sceneSet.props) {
				if (prop.support) {
					const supportObj = propPosMap.get(prop.support.objectId);
					if (!supportObj) {
						errors.push({
							path: `/sets/${sceneSet.id}/props/${prop.id}/support`,
							code: "UNKNOWN_SUPPORT_OBJECT",
							message: `Prop ${prop.id} references missing support object: ${prop.support.objectId}`,
							fatal: true,
						});
					} else {
						const offset = prop.support.offsetMeters ?? {};
						const resting = placePropOnSupport(prop, supportObj, offset);
						const height = prop.heightMeters ?? prop.height ?? 0.2;
						propPosMap.set(prop.id, { ...resting, height });
						compiledProps.push({
							id: prop.id,
							name: prop.name,
							x: resting.x,
							y: resting.y,
							z: resting.z,
							height,
							kind: prop.kind || "cube",
						rot: prop.yawDegrees ?? 0,
						acquisition: prop.acquisition || null,
						footprint: { width: prop.dimensionsMeters?.x ?? prop.dimensionsMeters?.width ?? prop.footprint?.width ?? height, depth: prop.dimensionsMeters?.z ?? prop.dimensionsMeters?.depth ?? prop.footprint?.depth ?? height },
						});

						hypotheses.push({
							id: `hyp_support_${prop.id}`,
							sourcePath: `/sets/${sceneSet.id}/props/${prop.id}`,
							rule: "support-surface-placement",
							chosenValue: { x: resting.x, y: resting.y, z: resting.z },
							confidence: 0.95,
							needsDecision: false,
						});
					}
				}
			}
		}

		// Process Cast Instances
		const compiledCast = [];
		const castMembers = Array.isArray(scene.cast) ? scene.cast : [];
		for (const cast of castMembers) {
			const char = characterMap.get(cast.characterId);
			if (!char) {
				errors.push({
					path: `/scenes/${scene.id}/cast/${cast.characterId}`,
					code: "UNKNOWN_ACTOR",
					message: `Cast member references unknown character: ${cast.characterId}`,
					fatal: true,
				});
				continue;
			}
			compiledCast.push({
				characterId: cast.characterId,
				x: Number(cast.positionMeters?.x) || 0,
				y: Number(cast.positionMeters?.y) || 0,
				z: Number(cast.positionMeters?.z) || 0,
				yawDeg: Number(cast.yawDegrees) || 0,
				height: char.heightMeters ?? 1.7,
			});
		}

		// Process Shots belonging to this scene
		const sceneShots = (snapshot.shots ?? []).filter((s) => s.sceneId === scene.id);
		let shotPlayhead = 0;
		const compiledShots = [];

		for (let shIdx = 0; shIdx < sceneShots.length; shIdx++) {
			const shot = sceneShots[shIdx];
			let shotInterval;
			try {
				shotInterval = normalizeInterval(shot.startSeconds, shot.endSeconds, fps);
			} catch (err) {
				errors.push({
					path: `/shots/${shot.id}`,
					code: "INVALID_SHOT_TIMING",
					message: `Shot ${shot.id} has invalid timing: ${err.message}`,
					fatal: true,
				});
				shotInterval = { startFrame: shotPlayhead, endFrameExclusive: shotPlayhead + 48, durationFrames: 48 };
			}

			// Local frames inside the scene
			const sceneStartFrame = shotInterval.startFrame;
			const sceneEndExclusive = shotInterval.endFrameExclusive;
			const shotDuration = sceneEndExclusive - sceneStartFrame;

			// Target resolution for camera framing
			const targets = Array.isArray(shot.camera?.targets) ? shot.camera.targets : [];
			let targetCenter = { x: 0, y: 0, z: 0, height: 1.7 };

			if (targets.length) {
				const resolved = [];
				for (const tId of targets) {
					const cast = compiledCast.find((c) => c.characterId === tId);
					if (cast) {
						resolved.push({ x: cast.x, y: cast.y, z: cast.z, height: cast.height });
					} else {
						const prop = compiledProps.find((p) => p.id === tId);
						if (prop) resolved.push({ x: prop.x, y: prop.y, z: prop.z, height: prop.height });
					}
				}
				if (resolved.length) {
					const avgX = resolved.reduce((acc, r) => acc + r.x, 0) / resolved.length;
					const avgY = resolved.reduce((acc, r) => acc + r.y, 0) / resolved.length;
					const avgZ = resolved.reduce((acc, r) => acc + r.z, 0) / resolved.length;
					const maxH = Math.max(...resolved.map((r) => r.height));
					targetCenter = { x: avgX, y: avgY, z: avgZ, height: maxH };
				}
			}

			// Plan camera framing
			const namedCamera = (scene.cameras || []).find(camera => camera.id === shot.cameraId);
			const framing = namedCamera?.cameraKeys?.[0]?.framing || planCameraFraming({
				target: targetCenter,
				shotType: shot.camera?.size ?? "medium",
				aspectRatio: aspect,
 yawDeg: shot.camera?.yawDegrees ?? 0,
 pitchDeg: shot.camera?.pitchDegrees ?? (shot.camera?.angle === "high" ? -20 : shot.camera?.angle === "low" ? 15 : 0),
			});

			const move = shot.camera?.move;
 const d = move?.distanceMeters || 0;
 const endFraming = move?.kind === "push-in" ? { ...framing, pos: { x: framing.pos.x - Math.sin(framing.yaw) * Math.cos(framing.pitch) * d, y: framing.pos.y + Math.sin(framing.pitch) * d, z: framing.pos.z - Math.cos(framing.yaw) * Math.cos(framing.pitch) * d } } : null;
 const cameraKeys = namedCamera?.cameraKeys || generateShotCameraKeys({ durationFrames: shotDuration, startFraming: framing, endFraming });
 const cameraId = namedCamera?.id || `cam_${shot.id}`;
 const cameraOffsetFrame = namedCamera ? shot.cameraOffsetFrame || 0 : 0;
 const cameraInterpolation = namedCamera?.interpolation || "smooth";
			compiledShots.push({
				id: shot.id,
				sceneId: scene.id,
				startFrame: sceneStartFrame,
				endFrameExclusive: sceneEndExclusive,
				durationFrames: shotDuration,
				cameraId,
				cameraOffsetFrame,
				framing,
			});

			// Register SequenceEntry
			sequence.push({
				shotId: shot.id,
				sceneId: scene.id,
				globalStartFrame: sceneGlobalStart + sceneStartFrame,
				globalEndFrameExclusive: sceneGlobalStart + sceneEndExclusive,
				sceneStartFrame,
			});

			// Create Shot ProductionUnit
			shotUnits.push({
				id: `unit_shot_${shot.id}`,
				kind: "shot",
				stage: "shot",
				sourceRefs: [shot.id],
				dependsOn: [`unit_scene_${scene.id}`],
				inputHash: inputHashOf({
					shotId: shot.id,
					sceneId: scene.id,
					startFrame: sceneStartFrame,
					endFrameExclusive: sceneEndExclusive,
					cameraId,
					framing,
					cameraKeys,
					cameraOffsetFrame,
					cameraInterpolation,
					directive: shot.directive,
				}),
				review: "ready",
				payload: {
					shotId: shot.id,
					sceneId: scene.id,
					startFrame: sceneStartFrame,
					endFrameExclusive: sceneEndExclusive,
					cameraId,
					framing,
					cameraKeys,
					cameraOffsetFrame,
					cameraInterpolation,
					cameraName: namedCamera?.name,
					directive: shot.directive,
				},
			});

			shotPlayhead = sceneEndExclusive;
		}

		// Scene ProductionUnit
		sceneUnits.push({
			id: `unit_scene_${scene.id}`,
			kind: "scene",
			stage: "scene",
			sourceRefs: [scene.id],
			dependsOn: [],
			inputHash: inputHashOf({
				sceneId: scene.id,
				name: scene.name,
				durationFrames: sceneDurationFrames,
				setId: scene.setId,
				entryState: scene.entryState,
				exitState: scene.exitState,
				summary: scene.summary,
			}),
			review: "ready",
			payload: {
				sceneId: scene.id,
				name: scene.name ?? `Scene ${scIdx + 1}`,
				durationFrames: sceneDurationFrames,
				setId: scene.setId,
				entryState: scene.entryState,
				exitState: scene.exitState,
				summary: scene.summary,
				timeContext: scene.timeContext,
			},
		});

		// Structure ProductionUnit
		if (sceneSet) {
			const compiledStructure = (sceneSet.structure || []).map((s, idx) => ({
				id: s.id || `${sceneSet.id}_struct_${idx}`,
				kind: s.kind || s.shape || "cube",
				rot: s.yawDegrees ?? 0,
				color: s.color,
				orientation: s.orientation || null,
				dimensions: s.dimensionsMeters || { width: 1, depth: 1, height: 1 },
				position: s.positionMeters || { x: 0, y: 0, z: 0 },
			}));

			structUnits.push({
				id: `unit_struct_${scene.id}_${sceneSet.id}`,
				kind: "structure",
				stage: "scene",
				sourceRefs: [sceneSet.id],
				dependsOn: [`unit_scene_${scene.id}`],
				inputHash: inputHashOf({
					sceneId: scene.id,
					setId: sceneSet.id,
					structure: compiledStructure,
					props: compiledProps,
				}),
				review: "ready",
				payload: {
					sceneId: scene.id,
					setId: sceneSet.id,
					structure: compiledStructure,
					props: compiledProps,
				},
			});
		}

		compiledScenes.push({
			id: scene.id,
			name: scene.name ?? `Scene ${scIdx + 1}`,
			durationFrames: sceneDurationFrames,
			shots: compiledShots,
		});

		globalPlayhead = sceneGlobalEnd;
	}

	// Add Character & Avatar ProductionUnits
	const avatarUnits = [];
	for (const char of characterMap.values()) {
		avatarUnits.push({
			id: `unit_avatar_${char.id}`,
			kind: "avatar",
			stage: "avatar",
			sourceRefs: [char.id],
			dependsOn: [],
			inputHash: inputHashOf({
				id: char.id,
				name: char.name,
				appearance: char.appearance ?? "",
				height: char.heightMeters ?? 1.7,
				avatar: char.avatar || null,
			}),
			review: "ready",
			payload: {
				characterId: char.id,
				name: char.name,
				appearance: char.appearance,
				heightMeters: char.heightMeters ?? 1.7,
				strategy: char.avatar?.strategy || "builtin",
				referenceResourceId: char.avatar?.referenceResourceId || null,
			},
		});
	}

	// Add Cast Instance ProductionUnits
	const castUnits = [];
	for (const scene of scenes) {
		const castMembers = Array.isArray(scene.cast) ? scene.cast : [];
		for (const cast of castMembers) {
			const char = characterMap.get(cast.characterId);
			castUnits.push({
				id: `unit_cast_${scene.id}_${cast.characterId}`,
				kind: "cast-instance",
				stage: "cast",
				sourceRefs: [cast.characterId, scene.id],
				dependsOn: [`unit_scene_${scene.id}`, `unit_avatar_${cast.characterId}`],
				inputHash: inputHashOf({
					sceneId: scene.id,
					characterId: cast.characterId,
					position: cast.positionMeters,
					yaw: cast.yawDegrees,
					height: char?.heightMeters ?? 1.7,
				}),
				review: "ready",
				payload: {
					characterId: cast.characterId,
					sceneId: scene.id,
					position: {
						x: Number(cast.positionMeters?.x) || 0,
						y: Number(cast.positionMeters?.y) || 0,
						z: Number(cast.positionMeters?.z) || 0,
					},
					yawDeg: Number(cast.yawDegrees) || 0,
					height: char?.heightMeters ?? 1.7,
				},
			});
		}
	}

	// Add Motion & Interaction ProductionUnits
	const actionUnits = [];
	for (const action of actions) {
		let interval = { startFrame: 0, endFrameExclusive: 72, durationFrames: 72 };
		try {
			interval = normalizeInterval(action.startSeconds, action.endSeconds, fps);
		} catch {
			// Timing errors were caught in validation
		}

		if (action.kind === "interaction") {
   const contactFrame = action.interaction?.contactSeconds !== undefined ? secondsToFrames(action.interaction.contactSeconds, fps) : (action.contactFrame ?? interval.startFrame + 24);
   const releaseFrame = action.interaction?.releaseSeconds != null ? secondsToFrames(action.interaction.releaseSeconds, fps) : null;
   if (contactFrame < interval.startFrame || contactFrame >= interval.endFrameExclusive || (releaseFrame !== null && (releaseFrame < contactFrame || releaseFrame > interval.endFrameExclusive))) {
    errors.push({ code: "INVALID_INTERACTION_TIMING", message: "Contact/release outside action window: " + action.id, fatal: true });
   }
			actionUnits.push({
				id: `unit_interaction_${action.id}`,
				kind: "interaction",
				stage: "interaction",
				sourceRefs: [action.id],
				dependsOn: [
					`unit_cast_${action.sceneId}_${action.characterId}`,
					`unit_scene_${action.sceneId}`,
				],
				inputHash: inputHashOf({
					actionId: action.id,
					kind: action.kind,
					characterId: action.characterId,
					sceneId: action.sceneId,
					objectId: action.objectId,
					startFrame: interval.startFrame,
					endFrameExclusive: interval.endFrameExclusive,
					contactFrame,
					releaseFrame,
					interaction: action.interaction || null,
					directive: action,
				}),
				review: "ready",
				payload: {
					actionId: action.id,
					kind: action.kind,
					characterId: action.characterId,
					sceneId: action.sceneId,
					objectId: action.objectId,
					hand: action.interaction?.hand || action.hand || "right",
					startFrame: interval.startFrame,
					contactFrame,
					releaseFrame,
					interaction: action.interaction || null,
					endFrameExclusive: interval.endFrameExclusive,
					durationFrames: interval.durationFrames,
					description: action.description,
					intent: action.intent,
					trajectory: action.trajectory,
					eventId: action.eventId,
					participantIds: action.participantIds,
					effects: action.effects,
				},
			});
		} else {
			const desc = (action.description || "").toLowerCase();
			const motionKind = snapshot.schemaVersion === "cozy-story-v2" ? "directive" : action.motionKind || (/wave|salu/.test(desc) ? "wave" : /walk|march|avance/.test(desc) ? "walk" : /nod|tête|tete/.test(desc) ? "nod" : /talk|parl/.test(desc) ? "talk" : /idle|immobile|attend/.test(desc) ? "idle" : "custom");
			actionUnits.push({
				id: `unit_motion_${action.id}`,
				kind: "motion-clip",
				stage: "motion-clip",
				sourceRefs: [action.id],
				dependsOn: [
					`unit_cast_${action.sceneId}_${action.characterId}`,
					`unit_scene_${action.sceneId}`,
				],
				inputHash: inputHashOf({
					actionId: action.id,
					characterId: action.characterId,
					sceneId: action.sceneId,
					startFrame: interval.startFrame,
					endFrameExclusive: interval.endFrameExclusive,
					description: action.description,
					motionKind,
					directive: action,
				}),
				review: "ready",
				payload: {
					actionId: action.id,
					characterId: action.characterId,
					sceneId: action.sceneId,
					startFrame: interval.startFrame,
					endFrameExclusive: interval.endFrameExclusive,
					durationFrames: interval.durationFrames,
					kind: action.kind,
					motionKind,
					description: action.description,
					objectId: action.objectId,
					intent: action.intent,
					trajectory: action.trajectory,
					eventId: action.eventId,
					participantIds: action.participantIds,
					effects: action.effects,
				},
			});
		}
	}

	// Assemble units in strictly topological order:
	// scenes -> structures -> avatars -> cast instances -> shots -> actions
 for (const expression of expressions) {
 actionUnits.push({ id: "unit_expression_" + expression.id, kind: "expressions", stage: "expressions", sourceRefs: [expression.id], dependsOn: ["unit_cast_" + expression.sceneId + "_" + expression.characterId], inputHash: inputHashOf(expression), review: "ready", payload: { ...expression } });
 }
	const units = [
		...sceneUnits,
		...structUnits,
		...avatarUnits,
		...castUnits,
		...shotUnits,
		...actionUnits,
	];

	const hasFatalErrors = errors.some((e) => e.fatal);
	if (hasFatalErrors) {
		return { plan: null, hypotheses, decisions, errors };
	}

	const productionId = `prod_${snapshot.projectId ?? "p"}_${simpleHash(snapshot.revision ?? "r1")}`;
	const doc = {
		version: 1,
		productionId,
		source: {
			projectId: snapshot.projectId,
			revision: snapshot.revision,
			fetchedSections: { manifest: true, scenes: true, characters: true, sets: true, shots: true, actions: true },
		},
		planRevision: 1,
		plan: {
			fps,
			aspect,
			frameCount: globalPlayhead,
			units,
			sequence,
		},
		bindings: {},
		resources: {},
	};

	const docValidation = validateProductionDocument(doc);
	if (!docValidation.valid) {
		for (const err of docValidation.errors) {
			errors.push({ ...err, fatal: true });
		}
		return { plan: null, hypotheses, decisions, errors };
	}

	return {
		plan: Object.freeze(doc),
		hypotheses: Object.freeze(hypotheses),
		decisions: Object.freeze(decisions),
		errors: Object.freeze(errors),
	};
}
