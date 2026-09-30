// The 3D asset library: find a prop, download it, stand it in the set.
//
// Two actions, and the split matters. `asset.searchLibrary` authors nothing —
// it reads a remote catalogue — so it is a read the agent may repeat freely.
// `asset.downloadLibraryModel` moves a file over the network and then makes
// exactly the same authored edit `asset.import` makes, so it is one undo entry
// and one job.
//
// Why this is not simply `asset.import` with an http(s) URL: that path asks the
// EDITOR to fetch the bytes, and Poly Pizza's search API sends no CORS headers
// (its CDN does, which is why the download is fine). The search therefore goes
// through the sidecar, and the licence gate has to live in code rather than in
// a tool description — an agent that is told to respect a licence and forgets
// must still not be able to install a model the studio may not ship.
import { studioActionDeclaration } from "../studio-actions.js";
import { ASSET_MAX_SOURCE_BYTES } from "../scene-assets.js";
import {
	downloadPolyModel,
	polyCredit,
	polyHeavyModelReason,
	polyHeightHint,
	polyLicenseAllows,
	polyLicenseOf,
	searchPolyModels,
} from "../poly-pizza.js";
import { fail } from "./shared.js";

const input = (required, optional = {}) => ({ type: "object", properties: { ...required, ...optional }, required: Object.keys(required), additionalProperties: false });

export const declarations = Object.freeze([
	// A search authors NOTHING, so it must not open a transaction: declared as a
	// mutation it would need an undo entry it has no use for, and as a transient
	// its answer would be dropped (the bus only carries `output` for a job, a
	// document or a long mutation). A job with a short deadline is exactly the
	// shape of "reads something, answers with a value": no domain to commit, no
	// history entry, and `output.models` still reaches the panel.
	{ ...studioActionDeclaration("asset.searchLibrary"), kind: "job", domain: null,
		input: input({ query: { type: "string", minLength: 1, maxLength: 120 } }, { limit: { type: "integer", minimum: 1, maximum: 20 } }) },
	{ ...studioActionDeclaration("asset.downloadLibraryModel"), kind: "job", domain: "objects",
		input: input(
			{ id: { type: "string", minLength: 1, maxLength: 64 }, title: { type: "string", minLength: 1, maxLength: 120 }, license: { type: "string", minLength: 1, maxLength: 60 } },
			{
				downloadUrl: { type: "string", minLength: 1, maxLength: 2048, pattern: "^https?://" },
				sourceUrl: { type: "string", maxLength: 2048, pattern: "^https?://" },
				creator: { type: "string", maxLength: 80 },
				attribution: { type: "string", maxLength: 400 },
				triCount: { type: "integer", minimum: 0 },
				heightHint: { type: "number", minimum: 0.05, maximum: 10 },
				height: { type: "number", minimum: 0.05, maximum: 10 },
				x: { type: "number" }, y: { type: "number" }, z: { type: "number" }, rot: { type: "number" },
				name: { type: "string", minLength: 1, maxLength: 120 },
			},
		) },
]);

/** The row a search result is quoted back as: exactly what a download needs. */
function modelSummary(model) {
	return {
		id: model.id,
		title: model.title,
		creator: model.creator,
		license: model.license.label,
		licenseUrl: model.license.url,
		usable: polyLicenseAllows(model),
		attribution: model.attribution,
		thumbnailUrl: model.thumbnailUrl,
		downloadUrl: model.downloadUrl,
		triCount: model.triCount,
		category: model.category,
		tags: [...model.tags],
		animated: model.animated,
		heightHint: polyHeightHint(model),
		heavy: Boolean(polyHeavyModelReason(model)),
		sourceUrl: model.sourceUrl,
	};
}

export function register(registry, ports) {
	const objects = () => ports.storeDomain?.("objects");
	const store = () => objects() ?? fail("TARGET_NOT_READY", "The objects document owner is not mounted.");

	registry.register({ ...declarations[0], available: () => true,
		run: async ({ query, limit }) => {
			// The searcher is a port so the editor owns the transport; the default
			// talks to the local sidecar, which is the only holder of the key.
			const result = await (ports.searchAssetLibrary ?? searchPolyModels)(query, { limit });
			const models = (result.models ?? []).map(modelSummary);
			const blocked = models.filter((model) => !model.usable);
			const warnings = [];
			// A licence the studio refuses is stated, never silently dropped:
			// an agent told only "here are 4 chairs" would pick a fifth one it
			// saw nowhere, or worse, retry until something slips through.
			if (blocked.length) warnings.push(`${blocked.length} result${blocked.length === 1 ? "" : "s"} cannot be used in the studio because of the licence (${blocked.map((model) => `${model.title}: ${model.license}`).join(", ")}).`);
			const heavy = models.filter((model) => model.heavy);
			if (heavy.length) warnings.push(`${heavy.length} result${heavy.length === 1 ? " is" : "s are"} heavy enough to slow the import (${heavy.map((model) => `${model.title}: ${model.triCount.toLocaleString("en-US")} triangles`).join(", ")}).`);
			return {
				affectedIds: [],
				summary: models.length
					? `Found ${models.length} of ${result.total} models for "${query}", ${models.filter((model) => model.usable).length} usable in the studio.`
					: `No models found for "${query}"${result.reason ? ` — ${result.reason}` : ""}.`,
				output: { source: result.source, total: result.total, reason: result.reason ?? null, models },
				...(warnings.length ? { warnings } : {}),
			};
		} });

	registry.register({ ...declarations[1], available: () => Boolean(objects()) || "The objects document owner is not mounted.",
		run: async (args, context) => {
			const license = polyLicenseOf({ Licence: args.license });
			if (!license.allows) {
				fail("INVALID_ARGUMENT", `"${args.title}" is licensed ${license.label}, which this studio cannot ship — pick a result whose licence it may use.`);
			}
			const model = {
				id: args.id, title: args.title, creator: args.creator ?? "", license,
				attribution: args.attribution ?? "", sourceUrl: args.sourceUrl ?? `https://poly.pizza/m/${args.id}`,
				downloadUrl: args.downloadUrl, triCount: args.triCount ?? null,
			};
			if (!model.downloadUrl) fail("INVALID_ARGUMENT", "A download needs the model's downloadUrl from the search result.");
			let file;
			try {
				file = await downloadPolyModel(model, { maxBytes: ASSET_MAX_SOURCE_BYTES, fetchImpl: ports.fetchAssetLibraryFile });
			} catch (error) {
				fail("TARGET_NOT_READY", `Not downloaded: ${error?.message || error}`);
			}
			// The domain owns the bytes-to-object path, exactly as it does for a
			// dropped file; the port is the fallback for a host that mounts it the
			// other way round. Reading the domain first keeps ONE implementation on
			// the hot path instead of two that can drift.
			const importLibraryModel = store().importLibraryModel ?? ports.importLibraryModel;
			if (typeof importLibraryModel !== "function") fail("CAPABILITY_MISSING", "This editor cannot place a downloaded model.");
			// The requested place, or none at all so the domain stands the model in
			// front of the shot camera — the same courtesy a dropped file gets.
			const placement = {};
			for (const key of ["x", "y", "z", "rot"]) if (Number.isFinite(args[key])) placement[key] = args[key];
			const credit = { ...polyCredit(model), downloadedAt: new Date().toISOString() };
			let imported;
			try {
				imported = await importLibraryModel({
					bytes: file.bytes, name: file.name, type: file.type, credit,
					...(Object.keys(placement).length ? { placement } : {}),
					...(args.name === undefined ? {} : { displayName: args.name }),
					...(Number.isFinite(args.height) ? { height: args.height } : {}),
					hint: args.heightHint ?? polyHeightHint(model),
				}, context);
			} catch (error) {
				fail(error.code ?? "INVALID_ARGUMENT", `Not imported: ${error?.message || error}`);
			}
			const heavy = args.triCount && args.triCount > 0 ? `${args.triCount} triangles` : "triangle count unknown";
			return {
				affectedIds: [imported.objectId],
				summary: `Downloaded ${model.title} from Poly Pizza (${model.license.label}, ${heavy}) as ${imported.name}, ${imported.height} m tall. ${model.attribution}`,
				output: { objectId: imported.objectId, assetId: imported.assetId, name: imported.name, height: imported.height, triCount: model.triCount,
					attribution: model.attribution, license: model.license.label, licenseUrl: model.license.url, sourceUrl: model.sourceUrl },
			};
		} });
}
