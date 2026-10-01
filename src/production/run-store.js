/**
 * Durable execution run-store and event journal.
 * Conforms to spec 04-orchestration-et-reprise §4-5.
 *
 * Implements:
 * - Append-only event log with monotonic sequence numbers.
 * - Deterministic idempotency key: project UUID + planRevision + unitId + inputHash.
 * - State machine tracking:
 *   pending -> ready -> running -> waiting-provider -> artifact-ready -> installing -> verified -> done
 *   Exceptions: blocked, failed, uncertain, stale.
 */

import { UNIT_RUN_STATES } from "./plan-contract.js";

export { UNIT_RUN_STATES, UNIT_RUN_STATES as UNIT_STATES };

/**
 * Computes deterministic idempotency key for an execution unit attempt.
 */
export function computeIdempotencyKey(projectIdOrObj, planRevision, unitId, inputHash) {
	if (typeof projectIdOrObj === "object" && projectIdOrObj !== null) {
		const { projectUuid, projectId, planRevision: rev, unitId: uid, inputHash: hash } = projectIdOrObj;
		return `${projectUuid || projectId || "project"}:rev${rev ?? 0}:${uid}:${hash}`;
	}
	return `${projectIdOrObj || "project"}:rev${planRevision ?? 0}:${unitId}:${inputHash}`;
}

/**
 * Creates an in-memory run store, optionally hydrated from existing checkpoint state.
 */
export function createRunStore(initialState = {}) {
	let sequence = initialState.sequence || 0;
	const events = Array.isArray(initialState.events) ? [...initialState.events] : [];
	const unitStates = new Map(
		(initialState.units || []).map((u) => [u.unitId, { ...u }])
	);
	const activeRuns = new Map(
		(initialState.runs || []).map((r) => [r.runId, { ...r }])
	);

	/**
	 * Append an event to the journal and update the unit's latest state.
	 */
	function appendEvent({
		runId = null,
		unitId = null,
		inputHash = null,
		attempt = 1,
		state,
		phase = null,
		message = "",
		progressKnown = null,
		resourceRefs = [],
		errorCode = null,
		externalJobId = null,
	}) {
		if (state && !UNIT_RUN_STATES.includes(state)) {
			throw new Error(`Invalid unit run state: ${state}`);
		}

		sequence += 1;
		const event = {
			eventId: `evt_${sequence}_${Date.now()}`,
			seq: sequence,
			sequence,
			timestamp: new Date().toISOString(),
			runId,
			unitId,
			inputHash,
			attempt,
			state,
			phase,
			message: String(message || "").slice(0, 500),
			progressKnown: progressKnown !== null ? Number(progressKnown) : null,
			resourceRefs: Array.isArray(resourceRefs) ? resourceRefs : [],
			errorCode: errorCode || null,
			externalJobId: externalJobId || null,
		};

		events.push(event);

		if (unitId) {
			const existing = unitStates.get(unitId) || {
				unitId,
				inputHash: inputHash || null,
				attempts: 0,
				state: "pending",
			};

			const next = {
				...existing,
				state: state || existing.state,
				phase: phase ?? existing.phase ?? null,
				inputHash: inputHash || existing.inputHash || null,
				lastSeq: sequence,
				lastUpdated: event.timestamp,
				attempts: Math.max(existing.attempts, attempt),
				lastError: errorCode ? { code: errorCode, message } : (state === "done" ? null : existing.lastError ?? null),
				resourceRefs: resourceRefs.length ? resourceRefs : existing.resourceRefs || [],
				externalJobId: externalJobId ?? existing.externalJobId ?? null,
			};
			unitStates.set(unitId, next);
		}

		return event;
	}

	function getUnitState(unitId) {
		return unitStates.get(unitId) || null;
	}

	function listUnitStates() {
		return Array.from(unitStates.values());
	}

	function listEvents({ runId = null, unitId = null, afterSeq = 0, limit = 100 } = {}) {
		let filtered = events;
		if (afterSeq > 0) {
			filtered = filtered.filter((e) => e.seq > afterSeq);
		}
		if (runId) {
			filtered = filtered.filter((e) => e.runId === runId);
		}
		if (unitId) {
			filtered = filtered.filter((e) => e.unitId === unitId);
		}
		return filtered.slice(0, limit);
	}

	function registerRun({ runId, planRevision, unitIds = [], grant = null }) {
		const runEntry = {
			runId,
			planRevision,
			unitIds: [...unitIds],
			grant: grant ? { ...grant } : null,
			startedAt: new Date().toISOString(),
			status: "active", // active | paused | completed | aborted
		};
		activeRuns.set(runId, runEntry);
		return runEntry;
	}

	function getRun(runId) {
		return activeRuns.get(runId) || null;
	}

	function setRunStatus(runId, status) {
		const run = activeRuns.get(runId);
		if (!run) return null;
		run.status = status;
		run.updatedAt = new Date().toISOString();
		return run;
	}

	/**
	 * Export state as checkpoint JSON payload for persistence in production domain.
	 */
	function exportCheckpoint() {
		return {
			sequence,
			events: events.slice(-500), // retain last 500 events in active checkpoint
			units: Array.from(unitStates.values()),
			runs: Array.from(activeRuns.values()).slice(-20),
		};
	}

	return {
		appendEvent,
		getUnitState,
		listUnitStates,
		listEvents,
		getJournal: listEvents,
		registerRun,
		getRun,
		setRunStatus,
		exportCheckpoint,
		get sequence() {
			return sequence;
		},
	};
}
