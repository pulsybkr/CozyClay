/**
 * Production command module - Implements studio bus actions for external production workflow.
 * Conforms to spec 04-orchestration-et-reprise.md §1 & §8.
 */
import { studioActionDeclaration } from "../studio-actions.js";
import { fail } from "./shared.js";
import { createProductionController } from "../production/controller.js";
import { fetchManifest, fetchValidatedSection } from "../production/source-client.js";

export const WHITELIST_DRAFT_OPS = Object.freeze([
	"set-prop-height",
	"set-placement",
	"assign-action-actor",
	"set-action-window",
	"choose-resource",
	"set-camera-intent",
	"resolve-decision",
]);

export const declarations = Object.freeze([
	{ ...studioActionDeclaration("production.connect"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.fetch"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.prepare"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.adapt"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.read"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.updateDraft"), kind: "document", undoDomain: "production" },
	{ ...studioActionDeclaration("production.acceptPlan"), kind: "document", undoDomain: "production" },
	{ ...studioActionDeclaration("production.runStage"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.runUnit"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.pause"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.resume"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.retry"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.verify"), kind: "job", domain: null },
	{ ...studioActionDeclaration("production.export"), kind: "job", domain: null },
]);

export function register(registry, ports) {
	const owner = () => ports.storeDomain?.("production");
	const available = () => Boolean(owner()) || "The production domain owner is not mounted.";

	let controller = null;
	let controllerOwner = null;
	function getController() {
		if (!controller || controllerOwner !== `${owner()?.read()?.productionId}:${owner()?.epoch || 0}`) {
			controllerOwner = `${owner()?.read()?.productionId}:${owner()?.epoch || 0}`;
			controller = createProductionController({
				productionDomain: owner(),
				bus: ports.bus ?? registry,
				handlers: ports.productionHandlers || {},
				readNativeScene: () => {
					const state = ports.state();
					const nativeScenes = ports.storeDomain?.("scenes")?.read?.() || state.scenes;
					if (!Array.isArray(nativeScenes)) return null;
					return { scenes: nativeScenes.map(s => s.id === state.activeSceneId ? { ...s, objects: state.objects || [], characters: state.characters || [], shots: state.shots || [], cameras: ports.storeDomain?.("shot")?.state?.()?.cameras || state.cameras || [] } : s) };
				},
			});
		}
		return controller;
	}

	function assertProduction(productionId) {
		const doc = owner()?.read();
		if (!doc) fail("TARGET_NOT_READY", "Production document is not available.");
		if (productionId && doc.productionId !== productionId) {
			fail("TARGET_NOT_READY", `Target production mismatch: requested ${productionId}, current is ${doc.productionId}`);
		}
		return doc;
	}

	// 1. production.connect
	registry.register({
		...studioActionDeclaration("production.connect"),
		available,
		run: async ({ connectionId, projectId }) => {
			const prod = owner();
			const manifest = await fetchManifest(connectionId, projectId);

			const sourceSnapshot = {
				connectionId,
				projectId,
				manifest,
				connectedAt: new Date().toISOString(),
				sections: {},
			};
			prod.setSourceSnapshot(sourceSnapshot);
			const doc = prod.read();

			return {
				affectedIds: [],
				summary: `Connected production source ${projectId} (connection ${connectionId}).`,
				output: {
					connectionId,
					projectId,
					productionId: doc.productionId,
					manifest,
				},
			};
		},
	});

	// 2. production.fetch
	registry.register({
		...studioActionDeclaration("production.fetch"),
		available,
		run: async ({ productionId, sections, revision }) => {
			assertProduction(productionId);
			const prod = owner();
			const currentSource = prod.read().source || {};

			const manifest = currentSource.manifest;
   if (!manifest?.revision) fail("TARGET_NOT_READY", "Connect to a valid source manifest first.");
   if (revision && revision !== manifest.revision) fail("PLAN_REVISION_CONFLICT", "Reconnect before fetching a different source revision.");
   const fetched = {};
   for (const section of sections) fetched[section] = await fetchValidatedSection(currentSource.connectionId, currentSource.projectId, manifest, section);
   const merged = { ...(currentSource.sections || {}), ...fetched };
   const snapshot = { schemaVersion: manifest.schemaVersion, projectId: manifest.projectId, revision: manifest.revision,
    title: manifest.title, sourceMode: manifest.sourceMode, project: manifest.project, resources: manifest.resources || [], ...merged };
   prod.setSourceSnapshot({ ...currentSource, revision: manifest.revision, sections: merged, snapshot });

			return {
				affectedIds: [],
				summary: `Fetched ${sections.length} production sections (${sections.join(", ")}).`,
				output: {
					productionId,
					sections,
					revision,
				},
			};
		},
	});

	// 3. production.prepare
	registry.register({
		...studioActionDeclaration("production.prepare"),
		available,
		run: async ({ productionId, scopeIds }) => {
			const doc = assertProduction(productionId);
			const ctrl = getController();
			const snapshot = doc.source?.snapshot || doc.source || {};
			const prep = ctrl.prepare(snapshot, doc.overrides || {});
			if (!prep.plan) fail("INVALID_ARGUMENT", "Compilation failed: " + prep.issues.map(i => i.message).join("; "));

			owner().writePlan((currentPlan) => ({
				...(prep.plan || currentPlan),
				accepted: false,
				issues: prep.issues || [],
				preparedAt: new Date().toISOString(),
			}));

			const updatedDoc = owner().read();
			return {
				affectedIds: [],
				summary: `Compiled production plan with ${prep.plan?.units?.length || 0} units and ${prep.issues?.length || 0} issues.`,
				output: {
					productionId,
					planRevision: updatedDoc.planRevision,
					unitsCount: prep.plan?.units?.length || 0,
					issues: (prep.issues || []).slice(0, 10),
					plan: prep.plan,
				},
			};
		},
	});

	// 4. production.adapt
	registry.register({
		...studioActionDeclaration("production.adapt"),
		available,
		run: async ({ productionId, sourceIds, expectedPlanRevision }) => {
			const doc = assertProduction(productionId);
			if (expectedPlanRevision !== undefined && doc.planRevision !== expectedPlanRevision) {
				fail("PLAN_REVISION_CONFLICT", `Expected plan revision ${expectedPlanRevision}, current is ${doc.planRevision}`);
			}
			if (doc.source?.manifest?.sourceMode === "structured") {
				return {
					affectedIds: [],
					summary: "Source is already structured CozyStory v1; no text adaptation required.",
					output: { productionId, sourceIds, adapted: false, reason: "already-structured" },
				};
			}
			fail("UNSUPPORTED_INTERACTION", "Story adaptation requires a configured AI text provider or structured source.");
		},
	});

	// 5. production.read
	registry.register({
		...studioActionDeclaration("production.read"),
		available,
		run: async ({ productionId, scope, cursor, limit = 20, unitId, runId, section }) => {
			const doc = assertProduction(productionId);
			const ctrl = getController();
			let data = null;

			if (scope === "summary") {
				data = {
					productionId: doc.productionId,
					planRevision: doc.planRevision,
					unitCount: doc.plan?.units?.length || 0,
					sourceConnected: Boolean(doc.source),
					checkpointSavedAt: doc.executionCheckpoint?.savedAt,
				};
			} else if (scope === "source") {
				if (section) {
					data = doc.source?.sections?.[section] || null;
				} else {
					data = {
						connectionId: doc.source?.connectionId,
						projectId: doc.source?.projectId,
						availableSections: Object.keys(doc.source?.sections || {}),
					};
				}
			} else if (scope === "units") {
				const allUnits = doc.plan?.units || [];
				const offset = cursor ? parseInt(cursor, 10) : 0;
				const sliced = allUnits.slice(offset, offset + limit);
				data = {
					units: sliced.map((u) => ({ id: u.id, kind: u.kind, stage: u.stage, status: u.status })),
					total: allUnits.length,
					nextCursor: offset + limit < allUnits.length ? String(offset + limit) : null,
				};
			} else if (scope === "unit") {
				if (!unitId) fail("INVALID_ARGUMENT", "Scope 'unit' requires unitId selector.");
				data = (doc.plan?.units || []).find((u) => u.id === unitId) || null;
				if (!data) fail("TARGET_NOT_READY", `Unit ${unitId} not found.`);
			} else if (scope === "run") {
				const checkpoint = ctrl.runStore.exportCheckpoint();
				data = {
					runStatus: runId ? ctrl.runStore.getRunStatus?.(runId) : null,
					units: checkpoint.units.slice(0, limit),
				};
			} else if (scope === "errors") {
				data = (doc.plan?.decisions || []).filter((d) => d.severity === "error" || d.severity === "warning");
			} else if (scope === "bindings") {
				data = doc.bindings || {};
			}

			// Ensure budget ceiling of 8 KiB
			const jsonStr = JSON.stringify(data);
			let boundedData = data;
			if (jsonStr && jsonStr.length > 8000) {
				boundedData = {
					truncated: true,
					preview: jsonStr.slice(0, 4000),
					message: "Result exceeds 8 KiB budget; use cursor/limit pagination to read full dataset.",
				};
			}

			return {
				affectedIds: [],
				summary: `Read production details for scope '${scope}'.`,
				output: { productionId, scope, data: boundedData },
			};
		},
	});

	// 6. production.updateDraft
	registry.register({
		...studioActionDeclaration("production.updateDraft"),
		available,
		run: async ({ productionId, expectedPlanRevision, operations }) => {
			const doc = assertProduction(productionId);
			if (expectedPlanRevision !== undefined && doc.planRevision !== expectedPlanRevision) {
				fail("PLAN_REVISION_CONFLICT", `Expected plan revision ${expectedPlanRevision}, current is ${doc.planRevision}`);
			}
			if (!Array.isArray(operations) || operations.length === 0) {
				fail("INVALID_ARGUMENT", "operations must be a non-empty array.");
			}
			if (operations.length > 100) {
				fail("INVALID_ARGUMENT", "At most 100 operations allowed per call.");
			}

			for (const op of operations) {
				if (!op.op || !WHITELIST_DRAFT_OPS.includes(op.op)) {
					fail("INVALID_ARGUMENT", `Operation '${op.op}' is not in allowed whitelist.`);
				}
			}

			owner().write((before) => ({
				...before,
				planRevision: (before.planRevision || 0) + 1,
				overrides: [...(before.overrides || []), ...operations],
				plan: { ...before.plan, accepted: false },
			}));

			return {
				affectedIds: [],
				summary: `Applied ${operations.length} typed patches to production draft.`,
				output: {
					productionId,
					planRevision: owner().read().planRevision,
					appliedCount: operations.length,
				},
			};
		},
	});

	// 7. production.acceptPlan
	registry.register({
		...studioActionDeclaration("production.acceptPlan"),
		available,
		run: async ({ productionId, expectedPlanRevision }) => {
			const doc = assertProduction(productionId);
			if (expectedPlanRevision !== undefined && doc.planRevision !== expectedPlanRevision) {
				fail("PLAN_REVISION_CONFLICT", `Expected plan revision ${expectedPlanRevision}, current is ${doc.planRevision}`);
			}

			owner().write((before) => ({
				...before,
				plan: {
					...(before.plan || {}),
					accepted: true,
					acceptedAt: new Date().toISOString(),
				},
			}));

			return {
				affectedIds: [],
				summary: `Production plan accepted at revision ${doc.planRevision}.`,
				output: {
					productionId,
					planRevision: doc.planRevision,
					accepted: true,
				},
			};
		},
	});

	// 8. production.runStage
	registry.register({
		...studioActionDeclaration("production.runStage"),
		available,
		run: async ({ productionId, stage, scopeIds = [], expectedPlanRevision }, context) => {
			const doc = assertProduction(productionId);
			if (expectedPlanRevision !== undefined && doc.planRevision !== expectedPlanRevision) {
				fail("PLAN_REVISION_CONFLICT", `Expected plan revision ${expectedPlanRevision}, current is ${doc.planRevision}`);
			}

			const allUnits = doc.plan?.units || [];
			const stageUnits = allUnits.filter((u) => {
				if (stage && u.stage !== stage && u.kind !== stage) return false;
				if (scopeIds.length > 0 && !scopeIds.some((s) => u.sourceRefs?.includes(s) || u.id.includes(s))) return false;
				return true;
			});

			if (stageUnits.length === 0) {
				fail("INVALID_ARGUMENT", `No units found for stage '${stage}' with given scope.`);
			}

			const ctrl = getController();
			const runResult = await ctrl.startRun({
				planRevision: doc.planRevision,
				unitIds: stageUnits.map((u) => u.id),
				signal: context?.signal,
			});

			return {
				affectedIds: [],
				summary: `Finished execution of stage '${stage}' (${stageUnits.length} units).`,
				output: {
					productionId,
					runId: runResult.runId,
					stage,
					unitsCount: stageUnits.length,
					status: runResult.status,
					counts: ctrl.reconcile().counts,
				},
			};
		},
	});

	// 9. production.runUnit
	registry.register({
		...studioActionDeclaration("production.runUnit"),
		available,
		run: async ({ productionId, unitId, expectedInputHash }, context) => {
			const doc = assertProduction(productionId);
			const unit = (doc.plan?.units || []).find((u) => u.id === unitId);
			if (!unit) fail("TARGET_NOT_READY", `Unit ${unitId} not found in current plan.`);
			if (expectedInputHash && unit.inputHash !== expectedInputHash) {
				fail("UNIT_INPUT_CHANGED", `Input hash mismatch: expected ${expectedInputHash}, got ${unit.inputHash}`);
			}

			const ctrl = getController();
			const result = await ctrl.executeUnit(unit, 1, { signal: context?.signal });

			return {
				affectedIds: [],
				summary: `Executed unit ${unitId}.`,
				output: {
					productionId,
					unitId,
					result,
				},
			};
		},
	});

	// 10. production.pause
	registry.register({
		...studioActionDeclaration("production.pause"),
		available,
		run: async ({ productionId, runId }) => {
			assertProduction(productionId);
			const ctrl = getController();
			const res = ctrl.pause(runId);
			return {
				affectedIds: [],
				summary: `Paused execution for run ${runId}.`,
				output: res,
			};
		},
	});

	// 11. production.resume
	registry.register({
		...studioActionDeclaration("production.resume"),
		available,
		run: async ({ productionId, runId }) => {
			assertProduction(productionId);
			const ctrl = getController();
			const res = await ctrl.resume(runId);
			return {
				affectedIds: [],
				summary: `Resumed execution for run ${runId}.`,
				output: res,
			};
		},
	});

	// 12. production.retry
	registry.register({
		...studioActionDeclaration("production.retry"),
		available,
		run: async ({ productionId, unitId, expectedAttempt }) => {
			assertProduction(productionId);
			const ctrl = getController();
			const res = await ctrl.retryUnit(unitId, { expectedAttempt });
			return {
				affectedIds: [],
				summary: `Retried execution for unit ${unitId}.`,
				output: res,
			};
		},
	});

	// 13. production.verify
	registry.register({
		...studioActionDeclaration("production.verify"),
		available,
		run: async ({ productionId, scopeIds }) => {
			assertProduction(productionId);
			const ctrl = getController();
			const rec = ctrl.reconcile();
			return {
				affectedIds: [],
				summary: `Production verified: ${rec.reconciledCount} units matched, ${rec.resumeCandidates.length} remaining.`,
				output: {
					productionId,
					verified: rec.totalUnits > 0 && rec.counts.done === rec.totalUnits,
					report: rec,
				},
			};
		},
	});

	// 14. production.export
	registry.register({
		...studioActionDeclaration("production.export"),
		available,
		run: async ({ productionId, expectedPlanRevision, options = {} }) => {
			const doc = assertProduction(productionId);
			if (expectedPlanRevision !== undefined && doc.planRevision !== expectedPlanRevision) {
				fail("PLAN_REVISION_CONFLICT", `Expected plan revision ${expectedPlanRevision}, current is ${doc.planRevision}`);
			}

			if (!doc.plan?.units || doc.plan.units.length === 0) {
				fail("EXPORT_NOT_VERIFIED", "Cannot export: production plan has no units.");
			}

			const ctrl = getController();
			const rec = ctrl.reconcile();
			if (rec.counts.done !== rec.totalUnits) fail("EXPORT_NOT_VERIFIED", "Cannot export: failed, blocked, uncertain or incomplete units remain.");
   const sceneIds = [...new Set(doc.plan.units.filter(u => u.kind === "scene").map(u => u.payload.sceneId))];
   if (sceneIds.length !== 1) fail("TARGET_NOT_READY", "Multi-scene video assembly is not configured; export is not complete.");
   if (Object.keys(options).length) fail("INVALID_ARGUMENT", "Production export options are not supported yet.");
   const nativeSceneId = doc.bindings?.[sceneIds[0]]?.nativeEntityId;
   if (!nativeSceneId) fail("EXPORT_NOT_VERIFIED", "Native scene binding missing.");
   await (ports.bus ?? registry).run("scene.switch", { sceneId: nativeSceneId });
   const encoded = await (ports.bus ?? registry).run("export.shotVideo", {});
   if (!encoded?.output?.fileName || encoded.output.frameCount !== doc.plan.frameCount) fail("EXPORT_NOT_VERIFIED", "Encoder produced no complete video artifact.");

			return {
				affectedIds: [],
				summary: `Production ${productionId} exported successfully.`,
				output: {
					productionId,
					exported: true,
					fileName: encoded.output.fileName,
					frameCount: encoded.output.frameCount,
				},
			};
		},
	});
}
