/**
 * Production reconciliation and recovery planner.
 * Conforms to spec 04-orchestration-et-reprise §4 and §6.
 *
 * Compares compiled plan units against stored checkpoints, resource store, and native bindings.
 * Detects:
 * - done: fully installed and verified.
 * - artifact-ready: resources downloaded/ready, can install directly without external/paid call.
 * - ready: dependencies satisfied, ready to execute.
 * - blocked: awaiting prerequisite unit dependencies.
 * - stale: inputHash changed or native bound entities deleted.
 * - failed/uncertain: previous attempt errors needing decision or retry.
 */

/**
 * Reconciles the production document, execution checkpoint, and optional scene snapshot.
 *
 * @param {object} options
 * @param {object} options.plan Compiled plan with .units array
 * @param {object} [options.checkpoint] Last execution checkpoint with .units
 * @param {object} [options.resources] Resource store instance or map of resources
 * @param {object} [options.bindings] Map of entity bindings
 * @param {object} [options.nativeScene] Current native scene state { objects, characters, shots, cameras }
 * @returns {object} RecoveryReport
 */
export function reconcile({
	plan,
	checkpoint = null,
	resources = null,
	bindings = {},
	nativeScene = null,
} = {}) {
	if (!plan || !Array.isArray(plan.units)) {
		return {
			ok: false,
			counts: { ready: 0, blocked: 0, done: 0, artifactReady: 0, stale: 0, failed: 0 },
			unitAssessments: {},
			resumeCandidates: [],
			warnings: ["No valid compiled plan provided for reconciliation."],
		};
	}

	const checkpointUnits = new Map(
		(checkpoint?.units || []).map((u) => [u.unitId, u])
	);

	const unitAssessments = {};
	const doneUnitIds = new Set();

	// Step 1: Identify units already marked done in checkpoint
	for (const unit of plan.units) {
		const cp = checkpointUnits.get(unit.id);
		if (cp && cp.state === "done" && cp.inputHash === unit.inputHash) {
			// Check if native bindings are still present if a nativeScene was supplied
			let bindingValid = true;
			if (nativeScene) {
    const bound = Object.entries(bindings).filter(([sourceId, b]) => b.unitId === unit.id || unit.sourceRefs?.includes(sourceId)).map(([, b]) => b);
    const scenes = nativeScene.scenes;
    if (["scene", "structure", "asset", "cast-instance", "shot"].includes(unit.kind) && !bound.length && !(unit.kind === "structure" && !(unit.payload?.props?.length || unit.payload?.structure?.length))) bindingValid = false;
    for (const binding of bound) {
     if (binding.nativeKind === "scene") {
      if (scenes && !scenes.some(s => s.id === binding.nativeEntityId)) bindingValid = false;
      continue;
     }
     const scene = scenes ? scenes.find(s => s.id === binding.nativeSceneId) : nativeScene;
     if (!scene) { bindingValid = false; continue; }
     const collection = { object: "objects", character: "characters", shot: "shots", camera: "cameras" }[binding.nativeKind];
     const rows = scene[collection] || scene.stage?.[collection] || scene.shotDocument?.[collection] || [];
     if (!rows.some(row => row.id === binding.nativeEntityId)) bindingValid = false;
    }
   }

			if (bindingValid) {
				doneUnitIds.add(unit.id);
				unitAssessments[unit.id] = {
					unitId: unit.id,
					status: "done",
					reason: "Unit is completed and verified.",
					canInstallDirectly: false,
				};
			} else {
				unitAssessments[unit.id] = {
					unitId: unit.id,
					status: "stale",
					reason: "Bound native entity was removed or modified in scene.",
					canInstallDirectly: false,
				};
			}
		}
	}

	// Step 2: Assess remaining units in dependency order
	for (const unit of plan.units) {
		if (unitAssessments[unit.id]) continue;

		const cp = checkpointUnits.get(unit.id);

		// Check dependencies
		const deps = unit.dependsOn || [];
		const unmetDeps = deps.filter((depId) => !doneUnitIds.has(depId));
		if (unmetDeps.length > 0) {
			unitAssessments[unit.id] = {
				unitId: unit.id,
				status: "blocked",
				reason: `Waiting on prerequisite units: ${unmetDeps.join(", ")}`,
				unmetDependencies: unmetDeps,
				canInstallDirectly: false,
			};
			continue;
		}

		// Check if resources already exist for this unit with exact inputHash
		let hasArtifactReady = false;
		if (resources) {
			const res = typeof resources.findByInputHash === "function"
				? resources.findByInputHash(unit.inputHash)
				: (resources[unit.inputHash] || null);

			if (res && res.status === "ready") {
				hasArtifactReady = true;
			}
		}

		if (hasArtifactReady) {
			unitAssessments[unit.id] = {
				unitId: unit.id,
				status: "artifact-ready",
				reason: "Asset or animation is cached and ready for local installation.",
				canInstallDirectly: true,
			};
			continue;
		}

		if (cp && cp.state === "failed") {
			unitAssessments[unit.id] = {
				unitId: unit.id,
				status: "failed",
				reason: cp.lastError?.message || "Previous attempt failed.",
				errorCode: cp.lastError?.code,
				canInstallDirectly: false,
			};
			continue;
		}

		if (cp && cp.state === "uncertain") {
			unitAssessments[unit.id] = {
				unitId: unit.id,
				status: "uncertain",
				reason: "External job state could not be verified; user confirmation required.",
				canInstallDirectly: false,
			};
			continue;
		}

		// Ready to execute
		unitAssessments[unit.id] = {
			unitId: unit.id,
			status: "ready",
			reason: "All dependencies met; ready to run.",
			canInstallDirectly: false,
		};
	}

	// Step 3: Aggregate counts and candidates for resume/run
	const counts = {
		done: 0,
		artifactReady: 0,
		ready: 0,
		blocked: 0,
		stale: 0,
		failed: 0,
		uncertain: 0,
	};

	const resumeCandidates = [];

	for (const assessment of Object.values(unitAssessments)) {
		const s = assessment.status;
		if (s === "done") counts.done += 1;
		else if (s === "artifact-ready") {
			counts.artifactReady += 1;
			resumeCandidates.push(assessment.unitId);
		} else if (s === "ready") {
			counts.ready += 1;
			resumeCandidates.push(assessment.unitId);
		} else if (s === "blocked") counts.blocked += 1;
		else if (s === "stale") {
			counts.stale += 1;
			resumeCandidates.push(assessment.unitId);
		} else if (s === "failed") counts.failed += 1;
		else if (s === "uncertain") counts.uncertain += 1;
	}

	return {
		ok: true,
		counts,
		reconciledCount: counts.done,
		staleCount: counts.stale,
		unitAssessments,
		units: unitAssessments,
		resumeCandidates,
		totalUnits: plan.units.length,
	};
}
