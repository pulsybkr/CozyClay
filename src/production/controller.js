/**
 * Production Controller - Durable execution coordinator.
 * Conforms to spec 04-orchestration-et-reprise §4-6.
 *
 * Implements:
 * - prepare(snapshot, overrides): { plan, issues }
 * - start({ planRevision, unitIds, grant }): { runId }
 * - pause(runId), resume(runId), retry(unitId)
 * - executeUnit(unit, attempt, { signal, emit, resources, bus }): Promise<Result>
 * - reconcile(document, journal, resources): RecoveryReport
 * - Sequential execution guaranteeing:
 *   1. Record attempt intention.
 *   2. Validate dependencies & grant.
 *   3. Produce artifact -> artifact-ready.
 *   4. Install into native scene via bus -> done.
 */

import { compile } from "./compiler.js";
import { reconcile as reconcilePlan } from "./reconcile.js";
import { createRunStore, computeIdempotencyKey } from "./run-store.js";
import { produceAvatar } from "./avatar-producer.js";
import {
	installSceneEnvironment,
	installSetStructures,
	installShots,
	installCastInstance,
} from "./installers/index.js";

/**
 * Creates a Production Controller instance.
 *
 * @param {object} options
 * @param {object} options.productionDomain Production state domain
 * @param {object} [options.bus] Command bus for native scene mutations
 * @param {object} [options.runStore] Pre-hydrated run-store instance
 * @returns {object} Controller instance
 */
export function createProductionController({
	productionDomain,
	bus = null,
	runStore = null,
	handlers = {},
	readNativeScene = null,
} = {}) {
	const store = runStore || createRunStore(productionDomain?.read?.()?.executionCheckpoint || {});
	const activeUnits = new Map();
 const initialEpoch = productionDomain?.epoch;
 const initialProductionId = productionDomain?.read?.()?.productionId;
 function checkDocument() {
  if (productionDomain?.epoch !== initialEpoch || productionDomain?.read?.()?.productionId !== initialProductionId) throw Object.assign(new Error("Production document was replaced."), { code: "STALE_TARGET" });
 }
 const originalAppend = store.appendEvent;
 function persist() {
  productionDomain?.write?.(doc => ({ ...doc, executionCheckpoint: { ...store.exportCheckpoint(), savedAt: new Date().toISOString() } }));
 }
 store.appendEvent = event => { checkDocument(); const result = originalAppend(event); persist(); return result; };
 let currentRunId = null;
	let abortController = null;

	/**
	 * Compile snapshot into plan without side-effects.
	 */
	function prepare(snapshot, overrides = {}) {
		const result = compile(snapshot, overrides);
		return {
			plan: result.plan?.plan || result.plan,
			productionDocument: result.plan,
			issues: [...(result.errors || []), ...(result.hypotheses || []), ...(result.decisions || [])],
		};
	}

	/**
	 * Run reconciliation between current plan and scene state.
	 */
	function reconcileState(nativeScene = null) {
		const doc = productionDomain.read();
		return reconcilePlan({
			plan: doc.plan,
			checkpoint: store.exportCheckpoint(),
			bindings: doc.bindings || {},
			nativeScene: nativeScene || readNativeScene?.() || null,
		});
	}

	/**
	 * Execute a single unit through its full lifecycle.
	 */
	async function executeOnce(unit, attempt = 1, { signal = null, emit = null } = {}) {
		if (signal?.aborted) {
			store.appendEvent({
				runId: currentRunId,
				unitId: unit.id,
				inputHash: unit.inputHash,
				attempt,
				state: "blocked",
				message: "Execution cancelled before start.",
			});
			throw new Error("Execution cancelled");
		}

		// 0. Validate prerequisite dependencies
		const depNotMet = (unit.dependsOn || []).find((depId) => {
			const s = store.getUnitState(depId);
			const dependency = productionDomain.read().plan?.units?.find(u => u.id === depId);
			return !s || s.state !== "done" || s.inputHash !== dependency?.inputHash;
		});
		if (depNotMet) {
			store.appendEvent({
				runId: currentRunId,
				unitId: unit.id,
				inputHash: unit.inputHash,
				attempt,
				state: "blocked",
				errorCode: "DEPENDENCY_NOT_MET",
				message: `Prerequisite dependency ${depNotMet} is not completed.`,
			});
			const err = new Error(`Prerequisite dependency ${depNotMet} is not satisfied for unit ${unit.id}`);
			err.code = "DEPENDENCY_NOT_MET";
			throw err;
		}

		// 1. Record attempt intention
		store.appendEvent({
			runId: currentRunId,
			unitId: unit.id,
			inputHash: unit.inputHash,
			attempt,
			state: "running",
			phase: "prepare",
			message: `Starting attempt ${attempt} for unit ${unit.id}`,
		});

		emit?.({ type: "unit.started", unitId: unit.id, attempt });

		try {
			// 2. Production phase based on unit kind
			let artifact = null;
			if (unit.kind === "avatar") {
				store.appendEvent({ runId: currentRunId, unitId: unit.id, inputHash: unit.inputHash, attempt, state: "waiting-provider", phase: "avatar" });
				artifact = await (handlers.avatar || produceAvatar)(unit, { signal });
				if (!artifact?.modelId) throw Object.assign(new Error("Avatar producer returned no native model."), { code: "INVALID_ARTIFACT" });
			} else if (unit.kind === "motion-clip" || unit.kind === "motion-compose") {
				store.appendEvent({ runId: currentRunId, unitId: unit.id, inputHash: unit.inputHash, attempt, state: "waiting-provider", phase: "motion" });
				if (!handlers[unit.kind]) throw Object.assign(new Error("Native motion production and installation are not configured."), { code: "PRODUCER_NOT_CONFIGURED" });
				artifact = await handlers[unit.kind](unit, { signal, bus });
			}

			checkDocument();
   if (signal?.aborted) throw new Error("Execution cancelled");
   const currentUnit = productionDomain.read().plan?.units?.find(u => u.id === unit.id);
   if (currentUnit && currentUnit.inputHash !== unit.inputHash) throw Object.assign(new Error("Unit input changed while producing its artifact."), { code: "UNIT_INPUT_CHANGED" });
   if (artifact) productionDomain?.setArtifact?.(unit.id, { ...artifact, inputHash: unit.inputHash });
   // 3. Mark artifact-ready
			store.appendEvent({
				runId: currentRunId,
				unitId: unit.id,
				inputHash: unit.inputHash,
				attempt,
				state: "artifact-ready",
				phase: "artifact",
				resourceRefs: artifact?.artifactRef ? [artifact.artifactRef] : [],
				message: "Artifact produced and verified.",
			});

			emit?.({ type: "unit.artifact-ready", unitId: unit.id, artifact });

			// 4. Native installation phase
			store.appendEvent({
				runId: currentRunId,
				unitId: unit.id,
				inputHash: unit.inputHash,
				attempt,
				state: "installing",
				phase: "installation",
				message: "Applying unit to native scene.",
			});

			let installResult;
   const context = { bus, bindings: productionDomain.read().bindings || {}, onBinding: patch => productionDomain?.patchBindings?.(patch) };
   if (unit.kind === "avatar") installResult = { ok: true, artifactRef: artifact.artifactRef };
   else if (handlers.install?.[unit.kind]) installResult = await handlers.install[unit.kind](unit, { ...context, artifact, signal });
   else if (bus) {
				if (unit.kind === "structure" || unit.kind === "asset") {
					installResult = await installSetStructures(unit, context);
				} else if (unit.kind === "shot") {
					installResult = await installShots([unit], context);
				} else if (unit.kind === "scene") {
					installResult = await installSceneEnvironment(unit, context);
				} else if (unit.kind === "cast-instance") {
					installResult = await installCastInstance(unit, { ...context, avatar: productionDomain.read().artifacts?.[`unit_avatar_${unit.payload.characterId}`] });
				}
			}

			if (!installResult || installResult.ok !== true) {
				const errMsg = installResult?.error || `Native installation failed for unit ${unit.id}`;
				const err = new Error(errMsg);
				err.code = "NATIVE_CONFLICT";
				throw err;
			}

			if (signal?.aborted) throw new Error("Execution cancelled after installation; reconcile before resuming.");
			if (installResult?.bindings) {
				productionDomain?.patchBindings?.(installResult.bindings);
			}

			// 5. Mark done and checkpoint
			store.appendEvent({
				runId: currentRunId,
				unitId: unit.id,
				inputHash: unit.inputHash,
				attempt,
				state: "done",
				phase: "complete",
				message: "Unit successfully installed and verified.",
			});

			persist();

			emit?.({ type: "unit.done", unitId: unit.id });

			return {
				ok: true,
				unitId: unit.id,
				artifact,
				installResult,
			};
		} catch (err) {
			const errorCode = err.code || "EXECUTION_FAILED";
			store.appendEvent({
				runId: currentRunId,
				unitId: unit.id,
				inputHash: unit.inputHash,
				attempt,
				state: signal?.aborted ? "blocked" : "failed",
				errorCode,
				message: err.message,
			});

			emit?.({ type: "unit.failed", unitId: unit.id, error: err.message, errorCode });
			throw err;
		}
	}

 async function executeUnit(unit, attempt = 1, options = {}) {
  const doc = productionDomain.read();
  const key = computeIdempotencyKey(doc.productionId, doc.planRevision, unit.id, unit.inputHash);
  if (activeUnits.has(key)) return activeUnits.get(key);
  if (activeUnits.size) throw Object.assign(new Error("Another production unit is running."), { code: "UNIT_BUSY" });
  const state = store.getUnitState(unit.id);
  if (state?.state === "done" && state.inputHash === unit.inputHash && reconcileState().unitAssessments?.[unit.id]?.status === "done") return { ok: true, unitId: unit.id, cached: true };
  const pending = executeOnce(unit, attempt, options);
  activeUnits.set(key, pending);
  try { return await pending; } finally { activeUnits.delete(key); }
 }

	/**
	 * Start a batch run for specified unit IDs or stage.
	 */
	async function startRun({ planRevision, unitIds = [], grant = null, onProgress = null, signal: parentSignal = null, lockAcquired = false } = {}) {
		const doc = productionDomain.read();
		if (!lockAcquired && globalThis.navigator?.locks?.request) return globalThis.navigator.locks.request("cozyclay-production:" + doc.productionId, { ifAvailable: true }, lock => {
 if (!lock) throw Object.assign(new Error("Another tab owns this production."), { code: "RUN_ALREADY_ACTIVE" });
 return startRun({ planRevision, unitIds, grant, onProgress, signal: parentSignal, lockAcquired: true });
 });
		const plan = doc.plan;
		if (!plan || !Array.isArray(plan.units)) {
			throw new Error("Cannot start run: No compiled plan present");
		}

		if (planRevision !== undefined && doc.planRevision !== planRevision) {
			throw new Error(`Plan revision conflict: expected ${planRevision}, current ${doc.planRevision}`);
		}

		// Check idempotency & active run
		if (abortController) {
			throw Object.assign(new Error("A production run is already active."), { code: "RUN_ALREADY_ACTIVE" });
		}
		abortController = new AbortController();
		const signal = abortController.signal;
		const runAbort = abortController;
		const forwardAbort = () => runAbort.abort(parentSignal.reason);
		if (parentSignal?.aborted) forwardAbort();
		parentSignal?.addEventListener("abort", forwardAbort, { once: true });

		const runId = `run_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
		currentRunId = runId;
		store.registerRun({ runId, planRevision: doc.planRevision, unitIds, grant });

		const unitsToExecute = unitIds.length > 0
			? plan.units.filter((u) => unitIds.includes(u.id))
			: plan.units;

		// Sort units topologically by dependencies
		const unitMap = new Map((plan.units || []).map((u) => [u.id, u]));
		const visited = new Set();
		const sorted = [];
		const visiting = new Set();

		function visit(u) {
			if (!u) throw new Error("Missing prerequisite unit.");
			if (visiting.has(u.id)) throw new Error("Cyclic production dependencies: " + u.id);
			if (visited.has(u.id)) return;
			visiting.add(u.id);
			for (const depId of u.dependsOn || []) {
				const dep = unitMap.get(depId);
				visit(dep);
			}
			visiting.delete(u.id);
			visited.add(u.id);
			sorted.push(u);
		}

		try {
			for (const u of unitsToExecute) visit(u);
		} catch (error) { parentSignal?.removeEventListener("abort", forwardAbort); abortController = null; store.setRunStatus(runId, "failed"); persist(); throw error; }

		const targetIdSet = new Set(unitsToExecute.map((u) => u.id));
		const orderedUnits = sorted.filter((u) => targetIdSet.has(u.id));

		// Execute sequentially
		const results = [];
		for (let i = 0; i < orderedUnits.length; i++) {
			if (signal.aborted) {
				store.setRunStatus(runId, "paused");
				break;
			}

			const unit = orderedUnits[i];
			onProgress?.({
				runId,
				index: i,
				total: orderedUnits.length,
				currentUnitId: unit.id,
				phase: "running",
			});

			try {
				const res = await executeUnit(unit, 1, {
					signal,
					emit: (evt) => onProgress?.({ runId, event: evt }),
				});
				results.push(res);
			} catch (err) {
				store.setRunStatus(runId, signal.aborted ? "paused" : "failed");
				persist();
				parentSignal?.removeEventListener("abort", forwardAbort);
				abortController = null;
				if (signal.aborted) break;
				throw err;
			}
		}

		if (!signal.aborted) {
			store.setRunStatus(runId, "completed");
		}

		persist();
		parentSignal?.removeEventListener("abort", forwardAbort);
		abortController = null;
		return {
			runId,
			completedCount: results.length,
			totalCount: orderedUnits.length,
			status: signal.aborted ? "paused" : "completed",
		};
	}

	function pause(runId) {
		if (abortController) {
			abortController.abort();
		}
		if (runId) {
			store.setRunStatus(runId, "paused");
		}
		return { ok: true, runId, status: "paused" };
	}

	async function resume(runId, options = {}) {
		const rec = reconcileState();
		const candidates = rec.resumeCandidates;
		if (rec.counts?.failed || rec.counts?.uncertain) throw new Error("Resume requires resolving failed or uncertain units first.");
		if (candidates.length === 0) {
			if (!rec.totalUnits || rec.counts.done !== rec.totalUnits) throw new Error("Production is blocked, not completed.");
			return { ok: true, runId, status: "done", message: "All units already completed." };
		}
		return await startRun({ ...options, unitIds: candidates });
	}

	async function retryUnit(unitId, options = {}) {
		const doc = productionDomain.read();
		const unit = (doc.plan?.units || []).find((u) => u.id === unitId);
		if (!unit) {
			throw new Error(`Unit ${unitId} not found in current plan`);
		}
		const existingState = store.getUnitState(unitId);
		const attempt = (existingState?.attempts || 0) + 1;
		if (options.expectedAttempt !== undefined && existingState?.attempts !== options.expectedAttempt) throw new Error("Attempt conflict.");
		return await executeUnit(unit, attempt, options);
	}

	return {
		prepare,
		reconcile: reconcileState,
		startRun,
		executeUnit,
		pause,
		resume,
		retryUnit,
		runStore: store,
	};
}
