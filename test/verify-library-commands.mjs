#!/usr/bin/env node
/**
 * The 3D library command module: what a search reports, and what a download is
 * allowed to install. Every port is injected, so nothing here touches the
 * network, the asset store or the renderer.
 *
 * The licence gate is the point of this suite. An agent that is told to respect
 * a licence and forgets must still not be able to put a model the studio may
 * not ship into someone's video, so the refusal is enforced in code and proved
 * here rather than trusted to a tool description.
 */
import assert from "node:assert/strict";

import { declarations, register } from "../src/commands/library.js";
import { normalizePolyModel } from "../src/poly-pizza.js";

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const checkAsync = async (name, fn) => { await fn(); checks.push(name); };

/** The API row shape, as the sidecar would return it. */
const apiRow = (over = {}) => ({
	ID: "iMNqRzPwwe", Title: "Chair", Description: null,
	Attribution: '"Chair" by Quaternius, https://poly.pizza/m/iMNqRzPwwe.',
	Thumbnail: "https://static.poly.pizza/thumb.webp",
	Download: "https://static.poly.pizza/model.glb",
	"Tri Count": 216,
	Creator: { Username: "Quaternius" },
	Category: "Furniture & Decor", Tags: ["Chair"], Licence: "CC0 1.0", Animated: false,
	...over,
});

/** A registry double that records what was installed and replays the commits. */
function registry() {
	const entries = new Map();
	return {
		register(entry) { entries.set(entry.id, entry); },
		entry(id) { return entries.get(id); },
		run(id, args, context = {}) { return entries.get(id).run(args, context); },
	};
}

/** An objects domain double: one in-memory document, one undo entry per commit. */
function objectsDomain() {
	let document = { objects: [] };
	const history = [];
	const domain = {
		read: () => document.objects,
		write: (update) => { document = { objects: typeof update === "function" ? update(document.objects) : update }; },
		importLibraryModel: async (args, context) => {
			domain.lastArgs = args;
			const object = { id: "mesh", name: args.displayName || "Model", renderer: "mesh", height: args.height ?? 1, x: 0, y: args.placement?.y ?? 0, z: 0, rot: 0, credit: args.credit };
			context.commit(() => { document = { objects: [...document.objects, object] }; });
			history.push(object);
			return { assetId: "mesh-aaaa", objectId: object.id, name: object.name, height: object.height, credit: args.credit };
		},
		history,
		lastArgs: null,
	};
	return domain;
}

/** A Response double: downloadPolyModel reads ok/status/headers/arrayBuffer. */
const fileResponse = (bytes = 8) => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(bytes) });

const portsFor = ({ models = [normalizePolyModel(apiRow())], download = async () => fileResponse() } = {}) => {
	const domain = objectsDomain();
	return {
		domain,
		ports: {
			storeDomain: (name) => (name === "objects" ? domain : null),
			searchAssetLibrary: async (query) => ({ source: "sidecar", total: models.length, models, reason: null }),
			fetchAssetLibraryFile: download,
			importLibraryModel: (args, context) => domain.importLibraryModel(args, context),
		},
	};
};

const commitContext = () => ({ commit: (fn) => fn(), check: () => {} });

/* -------------------------------------------------------- declarations ---- */

check("both library actions are declared as jobs", () => {
	assert.deepEqual(declarations.map((entry) => entry.id), ["asset.searchLibrary", "asset.downloadLibraryModel"]);
	for (const entry of declarations) {
		assert.equal(entry.kind, "job", entry.id);
		assert.equal(entry.input.additionalProperties, false, `${entry.id} input is closed`);
	}
});

check("a search must be asked for something; a download must name what it downloads", () => {
	assert.deepEqual(declarations[0].input.required, ["query"]);
	assert.deepEqual(declarations[1].input.required, ["id", "title", "license"]);
	// A downloadUrl is optional in the schema because it can arrive from the
	// search result the caller was just handed, but it is refused at run time
	// when it is missing — see the coverage below.
	assert.ok(declarations[1].input.properties.downloadUrl.pattern.startsWith("^https"));
});

check("a download is an objects edit, so it has one undo domain", () => {
	assert.equal(declarations[1].domain, "objects");
	assert.equal(declarations[1].undoDomain, "objects");
});

/* -------------------------------------------------------------- search ---- */

await checkAsync("a search reports each model with what a download needs, plus its height hint", async () => {
	const { ports } = portsFor();
	const r = registry();
	register(r, ports);
	const result = await r.run("asset.searchLibrary", { query: "chair" });
	assert.equal(result.affectedIds.length, 0, "a search authors nothing");
	assert.equal(result.output.source, "sidecar");
	assert.equal(result.output.models.length, 1);
	const row = result.output.models[0];
	// The five fields a download is made of, plus what a person reads.
	for (const key of ["id", "title", "creator", "license", "attribution", "thumbnailUrl", "downloadUrl", "sourceUrl"]) {
		assert.equal(typeof row[key], "string", key);
	}
	assert.equal(row.usable, true);
	assert.equal(row.heightHint, 0.9);
	assert.equal(row.triCount, 216);
	assert.equal(row.heavy, false);
});

await checkAsync("a licence the studio refuses is stated as a warning, never silently dropped", async () => {
	const models = [
		normalizePolyModel(apiRow()),
		normalizePolyModel(apiRow({ ID: "reserved1", Title: "Fancy Chair", Licence: "All rights reserved" })),
	];
	const { ports } = portsFor({ models });
	const r = registry();
	register(r, ports);
	const result = await r.run("asset.searchLibrary", { query: "chair" });
	assert.equal(result.output.models.length, 2, "both are listed, so the agent is not blind to them");
	assert.equal(result.output.models.find((row) => row.id === "reserved1").usable, false);
	assert.equal(result.warnings.length, 1);
	assert.match(result.warnings[0], /Fancy Chair: All rights reserved/);
	assert.match(result.summary, /1 usable in the studio/);
});

await checkAsync("a heavy model is called out before anyone downloads it", async () => {
	const models = [normalizePolyModel(apiRow({ "Tri Count": 400_000 }))];
	const { ports } = portsFor({ models });
	const r = registry();
	register(r, ports);
	const result = await r.run("asset.searchLibrary", { query: "couch" });
	assert.equal(result.output.models[0].heavy, true);
	assert.match(result.warnings[0], /400,000 triangles/);
});

await checkAsync("a library with no key says why it is empty instead of inventing a result", async () => {
	const r = registry();
	register(r, { storeDomain: () => objectsDomain(), searchAssetLibrary: async () => ({ source: "none", total: 0, models: [], reason: "Poly Pizza is not configured: set POLY_PIZZA_API_KEY." }) });
	const result = await r.run("asset.searchLibrary", { query: "chair" });
	assert.deepEqual(result.output.models, []);
	assert.match(result.output.reason, /POLY_PIZZA_API_KEY/);
	assert.match(result.summary, /Poly Pizza is not configured/);
});

/* ------------------------------------------------------------ download ---- */

await checkAsync("a usable model is downloaded, credited and installed in one entry", async () => {
	const downloaded = [];
	const { ports, domain } = portsFor({ download: async (url) => { downloaded.push(url); return fileResponse(); } });
	const r = registry();
	register(r, ports);
	const model = normalizePolyModel(apiRow({ Title: "Chair", Licence: "CC-BY 3.0" }));
	const result = await r.run("asset.downloadLibraryModel", {
		id: model.id, title: model.title, license: model.license.label, downloadUrl: model.downloadUrl,
		sourceUrl: model.sourceUrl, creator: model.creator, attribution: model.attribution,
	}, commitContext());
	assert.equal(downloaded.length, 1);
	assert.equal(downloaded[0], apiRow().Download, "the CDN URL the search returned is what is fetched");
	assert.equal(result.affectedIds.length, 1);
	assert.equal(domain.history.length, 1, "exactly one object was authored");
	// CC-BY requires the credit to survive onto the object, with a timestamp.
	assert.equal(domain.history[0].credit.creator, "Quaternius");
	assert.equal(domain.history[0].credit.license, "CC-BY 3.0");
	assert.match(domain.history[0].credit.downloadedAt, /^\d{4}-\d{2}-\d{2}T/);
	assert.match(result.summary, /CC-BY 3\.0/);
	assert.equal(result.output.licenseUrl, "https://creativecommons.org/licenses/by/3.0/");
});

await checkAsync("a model the studio may not ship is refused before any download", async () => {
	let downloads = 0;
	const { ports } = portsFor({ download: async () => { downloads += 1; return fileResponse(); } });
	const r = registry();
	register(r, ports);
	await assert.rejects(
		() => r.run("asset.downloadLibraryModel", { id: "reserved1", title: "Fancy Chair", license: "All rights reserved", downloadUrl: "https://static.poly.pizza/x.glb" }, commitContext()),
		(error) => error.code === "INVALID_ARGUMENT" && /cannot ship/.test(error.message),
	);
	assert.equal(downloads, 0, "nothing was fetched");
});

await checkAsync("a share-alike licence is refused as well", async () => {
	const { ports } = portsFor();
	const r = registry();
	register(r, ports);
	await assert.rejects(
		() => r.run("asset.downloadLibraryModel", { id: "sa1", title: "Chair", license: "CC-BY-SA 4.0", downloadUrl: "https://static.poly.pizza/x.glb" }, commitContext()),
		(error) => error.code === "INVALID_ARGUMENT",
	);
});

await checkAsync("a download without a URL is refused, not guessed", async () => {
	const { ports } = portsFor();
	const r = registry();
	register(r, ports);
	await assert.rejects(
		() => r.run("asset.downloadLibraryModel", { id: "x", title: "Chair", license: "CC0 1.0" }, commitContext()),
		(error) => error.code === "INVALID_ARGUMENT" && /downloadUrl/.test(error.message),
	);
});

await checkAsync("a failed download leaves the scene untouched", async () => {
	const { ports, domain } = portsFor({ download: async () => { throw new Error("the model file could not be downloaded (503)"); } });
	const r = registry();
	register(r, ports);
	await assert.rejects(
		() => r.run("asset.downloadLibraryModel", { id: "iMNqRzPwwe", title: "Chair", license: "CC0 1.0", downloadUrl: "https://static.poly.pizza/x.glb" }, commitContext()),
		(error) => error.code === "TARGET_NOT_READY",
	);
	assert.equal(domain.history.length, 0, "no object was authored");
});

await checkAsync("the requested place and size reach the domain", async () => {
	const { ports, domain } = portsFor();
	const r = registry();
	register(r, ports);
	const result = await r.run("asset.downloadLibraryModel", {
		id: "iMNqRzPwwe", title: "Chair", license: "CC0 1.0", downloadUrl: "https://static.poly.pizza/x.glb",
		x: 2, z: -3, rot: 45, height: 1.4, name: "Kitchen chair", heightHint: 0.9,
	}, commitContext());
	assert.deepEqual(domain.lastArgs.placement, { x: 2, z: -3, rot: 45 });
	assert.equal(domain.lastArgs.displayName, "Kitchen chair");
	assert.equal(domain.lastArgs.height, 1.4);
	assert.equal(domain.lastArgs.hint, 0.9);
	assert.equal(result.output.name, "Kitchen chair");
	assert.equal(result.affectedIds[0], "mesh");
});

await checkAsync("a search row's height hint travels to the import when no height was asked for", async () => {
	const { ports, domain } = portsFor();
	const r = registry();
	register(r, ports);
	await r.run("asset.downloadLibraryModel", {
		id: "iMNqRzPwwe", title: "Office Chair", license: "CC0 1.0", downloadUrl: "https://static.poly.pizza/x.glb",
	}, commitContext());
	assert.equal(domain.lastArgs.hint, 0.9, "the kind's hint stands in for an untrustworthy measurement");
	assert.equal("height" in domain.lastArgs, false, "no explicit height was asked for");
});

await checkAsync("the answer carries the attribution an export needs", async () => {
	const { ports } = portsFor();
	const r = registry();
	register(r, ports);
	const model = normalizePolyModel(apiRow());
	const result = await r.run("asset.downloadLibraryModel", {
		id: model.id, title: model.title, license: model.license.label, downloadUrl: model.downloadUrl,
		creator: model.creator, attribution: model.attribution, sourceUrl: model.sourceUrl, triCount: model.triCount,
	}, commitContext());
	assert.equal(result.output.attribution, model.attribution);
	assert.equal(result.output.sourceUrl, "https://poly.pizza/m/iMNqRzPwwe");
	assert.equal(result.output.triCount, 216);
	assert.match(result.summary, /216 triangles/);
});

console.log(`library commands: ${checks.length} checks passed`);
