// Production domain owner: manages the ProductionDocument across scenes with undo/redo support.
import { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../app-context.js';
import { createDocumentStore } from '../document-store.js';
import { useDocumentDomain } from '../store/use-document-store.js';
import { sanitizeProductionForExport } from '../production/resources.js';
import { PLAN_SCHEMA_VERSION, validateProductionDocument } from '../production/plan-contract.js';

export function createDefaultProductionDocument() {
	return {
		version: PLAN_SCHEMA_VERSION,
		productionId: globalThis.crypto?.randomUUID?.() ?? "prod-initial",
		source: null,
		planRevision: 0,
		plan: {
			fps: 24,
			aspect: "9:16",
			frameCount: 0,
			units: [],
			sequence: [],
			events: [],
			decisions: [],
		},
		bindings: {},
		artifacts: {},
		overrides: [],
		executionCheckpoint: {
			savedAt: new Date().toISOString(),
			units: [],
		},
	};
}

/**
 * Creates the production domain owner for CozyClay.
 * Stays mounted at project-level across scene switches.
 */
export function createProductionDomain(appContext) {
	let initialDoc = createDefaultProductionDocument();
 const sessionKey = "cozyclay-production-session-v1";
 try {
  const cached = JSON.parse(globalThis.localStorage?.getItem(sessionKey) || "null");
  const sceneIds = (appContext.shared?.startup?.document?.scenes || []).map(s => s.id).sort();
  if (cached && sceneIds.length && JSON.stringify(cached.sceneIds) === JSON.stringify(sceneIds) && validateProductionDocument(cached.document).valid) initialDoc = cached.document;
 } catch { /* Corrupt or unavailable session cache: keep an empty production. */ }
	const documentStore = createDocumentStore({ owned: { production: initialDoc } });

	const read = () => documentStore.read('production');
 const releaseSession = documentStore.subscribe(() => {
  if (!globalThis.localStorage) return;
  const scenes = appContext.storeDomain('scenes')?.read?.();
  if (!scenes?.length) return;
  try {
   globalThis.localStorage.setItem(sessionKey, JSON.stringify({ sceneIds: scenes.map(s => s.id).sort(), document: sanitizeProductionForExport(read()) }));
  } catch {
   appContext.notify?.("Production session could not be saved locally. Save the project file before closing.");
  }
 });
	let currentSession = null;
	let documentEpoch = 0;

	function beginAction() {
		const session = documentStore.beginAction('production');
		currentSession = session;
		return {
			run: fn => session.run(fn),
			touch: d => session.touch(d),
			update: (d, u) => session.update(d, u),
			cancel: opts => {
				const res = session.cancel(opts);
				currentSession = null;
				return res;
			},
			commit: () => {
				const res = session.commit();
				currentSession = null;
				return res;
			},
		};
	}

	function recordAction(labelOrFn, fnArg) {
		const fn = typeof labelOrFn === 'function' ? labelOrFn : fnArg;
		if (typeof fn !== 'function') throw new TypeError('recordAction requires a function');
		if (currentSession) {
			return { result: fn() };
		}
		const session = beginAction();
		try {
			const result = session.run(fn);
			return { result, ...session.commit() };
		} catch (error) {
			session.cancel();
			throw error;
		}
	}

	function write(updater) {
		const doUpdate = before => {
			const next = typeof updater === 'function' ? updater(before) : updater;
			return JSON.stringify(before) === JSON.stringify(next) ? before : next;
		};
		if (currentSession) {
			return documentStore.write('production', doUpdate);
		}
		return recordAction(() => documentStore.write('production', doUpdate)).result;
	}

	function writePlan(updater) {
		return write(before => {
			const newPlan = typeof updater === 'function' ? updater(before.plan) : updater;
			return {
				...before,
				planRevision: (before.planRevision ?? 0) + 1,
				plan: newPlan,
			};
		});
	}

	function setSourceSnapshot(sourceOrSnapshot, manifestArg, connectionIdArg, projectIdArg) {
		let sourceObj = null;
		if (sourceOrSnapshot) {
			const snap = sourceOrSnapshot.snapshot || (sourceOrSnapshot.characters || sourceOrSnapshot.project ? sourceOrSnapshot : null);
			const manifest = sourceOrSnapshot.manifest || manifestArg || null;
			const connectionId = sourceOrSnapshot.connectionId ?? connectionIdArg ?? null;
			const projectId = sourceOrSnapshot.projectId ?? snap?.projectId ?? projectIdArg ?? null;
			const revision = sourceOrSnapshot.revision ?? snap?.revision ?? manifest?.revision ?? null;
			const sections = sourceOrSnapshot.sections ?? (snap ? {
				characters: snap.characters || [],
				sets: snap.sets || [],
				scenes: snap.scenes || [],
				shots: snap.shots || [],
				actions: snap.actions || [],
				narration: snap.narration || [],
			} : {});

			sourceObj = {
				connectionId,
				projectId,
				revision,
				manifest,
				snapshot: snap,
				sections,
				connectedAt: sourceOrSnapshot.connectedAt || new Date().toISOString(),
			};
		}
		return write(before => ({
			...before,
			source: sourceObj,
			...(before.source && (before.source.projectId !== sourceObj?.projectId || before.source.revision !== sourceObj?.revision) ? {agentExecution:null} : {}),
			...(before.source && (before.source.projectId !== sourceObj?.projectId || before.source.revision !== sourceObj?.revision) ? { planRevision: (before.planRevision || 0) + 1, plan: { ...createDefaultProductionDocument().plan }, overrides: [], ...(before.source.projectId !== sourceObj?.projectId ? { bindings: {}, artifacts: {}, executionCheckpoint: { units: [], events: [], runs: [] } } : {}) } : {}),
		}));
	}

	function patchBindings(bindingsPatch) {
		return write(before => ({
			...before,
			bindings: {
				...(before.bindings ?? {}),
				...bindingsPatch,
			},
		}));
	}

	function artifactReferences() {
		const current = read();
		return Object.values(current.artifacts ?? {});
	}

	function setArtifact(artifactId, artifactRef) {
		return write(before => ({
			...before,
			artifacts: {
				...(before.artifacts ?? {}),
				[artifactId]: artifactRef,
			},
		}));
	}

	function updateCheckpoint(unitRun) {
		return write(before => {
			const currentUnits = before.executionCheckpoint?.units ?? [];
			const nextUnits = currentUnits.filter(u => u.unitId !== unitRun.unitId);
			nextUnits.push(unitRun);
			return {
				...before,
				executionCheckpoint: {
					savedAt: new Date().toISOString(),
					units: nextUnits,
				},
			};
		});
	}

	/**
	 * Detects if bound native entities have disappeared from the active scene
	 * or diverged, marking their corresponding units as "stale".
	 */
	function invalidateBindingsAgainstScene(scene) {
		if (!scene || typeof scene !== "object") return;
		const current = read();
		const bindings = current.bindings ?? {};
		const stage = scene.stage ?? {};
		const objects = new Set((stage.objects ?? []).map(o => o.id));
		const characters = new Set((stage.characters ?? []).map(c => c.id));

		let changed = false;
		const staleUnitIds = new Set();

		for (const [sourceId, binding] of Object.entries(bindings)) {
			let missing = false;
			if (binding.nativeSceneId && binding.nativeSceneId !== scene.id) continue;
			if (binding.nativeKind === 'object' && !objects.has(binding.nativeEntityId)) {
				missing = true;
			} else if (binding.nativeKind === 'character' && !characters.has(binding.nativeEntityId)) {
				missing = true;
			}
			if (missing) {
				staleUnitIds.add(binding.unitId || sourceId);
				changed = true;
			}
		}

		if (changed && current.executionCheckpoint?.units) {
			write(before => ({
				...before,
				executionCheckpoint: {
					...before.executionCheckpoint,
					units: before.executionCheckpoint.units.map(u => {
						if (staleUnitIds.has(u.unitId)) {
							return { ...u, state: "stale" };
						}
						return u;
					}),
				},
			}));
		}
	}

	function exportPortable() {
		const doc = read();
		return sanitizeProductionForExport(doc);
	}

	function loadPortable(portableDoc) {
		documentEpoch += 1;
		const nextDoc = portableDoc ? structuredClone(portableDoc) : createDefaultProductionDocument();
		if (portableDoc) {
			const valid = validateProductionDocument(portableDoc);
			if (!valid.valid) {
				console.warn("Invalid production document provided to loadPortable:", valid.errors);
			}
		}
		write(() => nextDoc);
	}

	const canUndo = id => documentStore.canUndo(id);
	function stepHistory(redo) {
		return Boolean((redo ? documentStore.redo : documentStore.undo)());
	}

	const document = () => ({ production: read() });

	const domain = {
		get epoch() { return documentEpoch; },
		documentStore,
		document,
		read,
		write,
		publish: state => (state?.production !== undefined ? write(state.production) : null),
		commitDraft: write,
		writePlan,
		setSourceSnapshot,
		patchBindings,
		setArtifact,
		artifactReferences,
		updateCheckpoint,
		invalidateBindingsAgainstScene,
		exportPortable,
		loadPortable,
		beginAction,
		recordAction,
		canUndo,
		stepHistory,
		dispose() {
			unregister();
			releaseSession();
			documentStore.dispose();
		},
	};

	const unregister = appContext.registerStoreDomain('production', domain);
	return domain;
}

/**
 * React hook to consume and interact with the production domain.
 */
export function useProduction(appContext) {
	const [domain] = useState(() => appContext.storeDomain('production') ?? createProductionDomain(appContext));
	const productionDoc = useDocumentDomain(domain.documentStore, 'production');

	return {
		...domain,
		production: productionDoc,
	};
}
