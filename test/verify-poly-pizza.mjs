#!/usr/bin/env node
/**
 * Poly Pizza client: paths, normalisation, licence handling, ranking, and the
 * sidecar-backed search. No network — every fetch is injected.
 */
import assert from "node:assert/strict";

import {
	POLY_SEARCH_MAX_LIMIT,
	POLY_SEARCH_MAX_PAGE,
	POLY_TRI_COUNT_WARN,
	downloadPolyModel,
	polyAttributionLine,
	polyCredit,
	polyFileName,
	polyHeavyModelReason,
	polyHeightHint,
	polyLicenseAllows,
	polyLicenseOf,
	polyModelPath,
	polySearchPath,
	normalizePolyModel,
	normalizePolySearch,
	rankPolyModels,
	resolvePolyObjectHeight,
	searchPolyModels,
} from "../src/poly-pizza.js";

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const checkAsync = async (name, fn) => { await fn(); checks.push(name); };

/* ------------------------------------------------------------- paths ---- */

check("a search term is encoded into one path segment", () => {
	assert.equal(polySearchPath("chair"), "/search/chair?limit=12");
	assert.equal(polySearchPath("office chair").startsWith("/search/office%20chair?"), true);
});

check("a slash in a term cannot address another route", () => {
	// %2F would decode to a path separator server-side; double-encoding keeps
	// the term a term rather than turning it into /../ something else.
	const path = polySearchPath("a/b");
	assert.equal(path.includes("/search/a%252Fb?"), true);
	assert.equal(path.split("?")[0].split("/").length, 3, "still exactly one segment");
});

check("the limit is bounded and the page is optional", () => {
	assert.equal(polySearchPath("chair", { limit: 999 }).includes(`limit=${POLY_SEARCH_MAX_LIMIT}`), true);
	assert.equal(polySearchPath("chair", { limit: 0 }).includes("limit=1"), true);
	assert.equal(polySearchPath("chair").includes("page="), false);
	assert.equal(polySearchPath("chair", { page: 999 }).includes(`page=${POLY_SEARCH_MAX_PAGE}`), true);
});

check("an empty term and an empty id are refused, not sent", () => {
	assert.throws(() => polySearchPath("   "), /words/);
	assert.throws(() => polyModelPath(""), /id/);
	assert.equal(polyModelPath("iMNqRzPwwe"), "/model/iMNqRzPwwe");
});

/* --------------------------------------------------------- licences ---- */

check("CC0 is usable without a credit obligation", () => {
	const license = polyLicenseOf({ Licence: "CC0 1.0" });
	assert.equal(license.id, "cc0");
	assert.equal(license.allows, true);
	assert.equal(license.requiresAttribution, false);
	assert.match(license.url, /publicdomain\/zero\/1\.0/);
});

check("CC-BY is usable and obliges attribution, at its own version", () => {
	const license = polyLicenseOf({ Licence: "CC-BY 3.0" });
	assert.equal(license.allows, true);
	assert.equal(license.requiresAttribution, true);
	assert.equal(license.url, "https://creativecommons.org/licenses/by/3.0/");
});

check("a share-alike licence is not silently treated as plain CC-BY", () => {
	const license = polyLicenseOf({ Licence: "CC-BY-SA 4.0" });
	assert.equal(license.id, "cc-by-sa");
	assert.equal(license.allows, false, "the set is a derivative work");
});

check("non-commercial and no-derivatives licences are refused and not treated as plain CC-BY", () => {
	for (const lic of ["CC-BY-NC 4.0", "CC-BY-ND 3.0", "CC-BY-NC-ND 4.0", "CC-BY-NC-SA 4.0"]) {
		const parsed = polyLicenseOf({ Licence: lic });
		assert.equal(parsed.allows, false, `${lic} must not be allowed`);
		assert.notEqual(parsed.id, "cc-by", `${lic} must not be identified as cc-by`);
	}
});

check("an unstated or unreadable licence is refused, never defaulted permissive", () => {
	for (const raw of [{}, { Licence: "" }, { Licence: "All rights reserved" }, null]) {
		const license = polyLicenseOf(raw);
		assert.equal(license.allows, false, JSON.stringify(raw));
		assert.equal(license.requiresAttribution, true);
	}
});

/* ------------------------------------------------------ normalisation ---- */

const apiChair = {
	ID: "iMNqRzPwwe",
	Title: "Chair",
	Description: null,
	Attribution: '"Chair" by Quaternius, https://poly.pizza/m/iMNqRzPwwe. Licence at https://creativecommons.org/publicdomain/zero/1.0/',
	Thumbnail: "https://static.poly.pizza/84ecc6a3.webp",
	Download: "https://static.poly.pizza/84ecc6a3.glb",
	"Tri Count": 216,
	Creator: { Username: "Quaternius", DPURL: "https://static.poly.pizza/dp%2Ff63b.jpg" },
	Uploaded: "2021-10-03T10:07:22.863Z",
	Category: "Furniture & Decor",
	Tags: ["Chair", "Furniture"],
	Licence: "CC0 1.0",
	Animated: false,
	Orbit: { phi: "1.23", radius: "2.7", theta: "-0.42" },
};

check("a real API row normalises into the studio's shape", () => {
	const model = normalizePolyModel(apiChair);
	assert.equal(model.id, "iMNqRzPwwe");
	assert.equal(model.title, "Chair");
	assert.equal(model.creator, "Quaternius");
	assert.equal(model.triCount, 216);
	assert.equal(model.category, "Furniture & Decor");
	assert.deepEqual([...model.tags], ["Chair", "Furniture"]);
	assert.equal(model.sourceUrl, "https://poly.pizza/m/iMNqRzPwwe");
	assert.equal(model.license.id, "cc0");
	assert.equal(model.animated, false);
	assert.equal(Object.isFrozen(model), true);
});

check("a row without a model file or an id is dropped", () => {
	assert.equal(normalizePolyModel({ ...apiChair, Download: "" }), null);
	assert.equal(normalizePolyModel({ ...apiChair, ID: "" }), null);
	assert.equal(normalizePolyModel({ ...apiChair, ID: "../etc/passwd" }), null);
	assert.equal(normalizePolyModel(null), null);
});

check("a non-http download URL is refused", () => {
	assert.equal(normalizePolyModel({ ...apiChair, Download: "javascript:alert(1)" }), null);
	assert.equal(normalizePolyModel({ ...apiChair, Download: "data:model/gltf-binary;base64,AA" }), null);
});

check("a missing triangle count stays unknown, never zero-as-free", () => {
	const model = normalizePolyModel({ ...apiChair, "Tri Count": 0 });
	assert.equal(model.triCount, null);
	assert.equal(normalizePolyModel({ ...apiChair, "Tri Count": undefined }).triCount, null);
});

check("an animated model says so", () => {
	assert.equal(normalizePolyModel({ ...apiChair, Animated: true }).animated, true);
});

check("a search payload keeps its total and drops unusable rows", () => {
	const result = normalizePolySearch({ total: 262, results: [apiChair, { ID: "x", Title: "no file" }, apiChair] });
	assert.equal(result.total, 262);
	assert.equal(result.models.length, 2);
	assert.equal(Object.isFrozen(result.models), true);
});

check("a payload with no results is empty, not an error", () => {
	assert.deepEqual({ total: normalizePolySearch({ total: 0, results: [] }).total, n: normalizePolySearch({}).models.length }, { total: 0, n: 0 });
	assert.equal(normalizePolySearch(null).models.length, 0);
});

/* ---------------------------------------------------------- attribution ---- */

check("the published attribution is used verbatim when present", () => {
	const model = normalizePolyModel(apiChair);
	assert.equal(polyAttributionLine(model), apiChair.Attribution);
});

check("attribution is composed when the API left the field empty", () => {
	const model = normalizePolyModel({ ...apiChair, Attribution: null });
	const line = polyAttributionLine(model);
	assert.match(line, /by Quaternius/);
	assert.match(line, /poly\.pizza\/m\/iMNqRzPwwe/);
	assert.match(line, /CC0 1\.0/);
});

check("a credit carries what an attribution export needs", () => {
	const credit = polyCredit(normalizePolyModel(apiChair));
	assert.equal(credit.library, "poly.pizza");
	assert.equal(credit.id, "iMNqRzPwwe");
	assert.equal(credit.creator, "Quaternius");
	assert.equal(credit.licenseUrl, "https://creativecommons.org/publicdomain/zero/1.0/");
	assert.equal(polyCredit(null), null);
});

/* -------------------------------------------------------------- ranking ---- */

check("a usable licence outranks a bigger, more relevant model", () => {
	// CC-BY is usable WITH attribution, so both of these are admissible; the
	// licence tier only separates admissible from inadmissible.
	const bothUsable = [
		normalizePolyModel({ ...apiChair, ID: "aaa", Licence: "CC-BY 4.0", "Tri Count": 5000 }),
		normalizePolyModel({ ...apiChair, ID: "bbb", Licence: "CC0 1.0", "Tri Count": 9000 }),
	];
	assert.deepEqual([...rankPolyModels(bothUsable, "chair")].map((m) => m.id).sort(), ["aaa", "bbb"], "both stay available");
	const mixed = [
		normalizePolyModel({ ...apiChair, ID: "aaa", Licence: "All rights reserved", "Tri Count": 5000 }),
		normalizePolyModel({ ...apiChair, ID: "bbb", Licence: "CC0 1.0", "Tri Count": 9000 }),
	];
	assert.equal(rankPolyModels(mixed, "chair")[0].id, "bbb");
});

check("between two usable models the lighter one wins", () => {
	const models = [
		normalizePolyModel({ ...apiChair, ID: "heavy", "Tri Count": 60000 }),
		normalizePolyModel({ ...apiChair, ID: "light", "Tri Count": 300 }),
	];
	assert.equal(rankPolyModels(models, "chair")[0].id, "light");
});

check("an exact title beats a longer title containing the word", () => {
	const models = [
		normalizePolyModel({ ...apiChair, ID: "long", Title: "Modern Office Chair" }),
		normalizePolyModel({ ...apiChair, ID: "exact", Title: "Chair" }),
	];
	assert.equal(rankPolyModels(models, "chair")[0].id, "exact");
});

check("an unusable model still appears, just last", () => {
	const models = [
		normalizePolyModel({ ...apiChair, ID: "reserved", Licence: "All rights reserved", "Tri Count": 10 }),
		normalizePolyModel({ ...apiChair, ID: "cc0", "Tri Count": 90000 }),
	];
	const ranked = rankPolyModels(models, "chair");
	assert.equal(ranked.length, 2);
	assert.equal(ranked.at(-1).id, "reserved");
	assert.equal(polyLicenseAllows(ranked.at(-1)), false);
});

/* ------------------------------------------------------- height hint ---- */

check("a category hint gives the agent a sane starting height", () => {
	const titleOnly = { ...apiChair, Tags: [], Category: "" };
	assert.equal(polyHeightHint(normalizePolyModel({ ...titleOnly, Title: "Wooden Door" })), 2.05);
	assert.equal(polyHeightHint(normalizePolyModel({ ...titleOnly, Title: "Office Chair" })), 0.9);
	assert.equal(polyHeightHint(normalizePolyModel({ ...titleOnly, Title: "Coffee Table" })), 0.75);
	assert.equal(polyHeightHint(normalizePolyModel({ ...titleOnly, Title: "Unlabelled" })), null);
});

check("a hint is a hint: an unknown prop gets no number rather than a wrong one", () => {
	assert.equal(polyHeightHint(null), null);
	assert.equal(polyHeightHint(normalizePolyModel({ ...apiChair, Title: "Zorblax", Category: "Other", Tags: [] })), null);
});

check("a pathological triangle count is called out before the download", () => {
	const heavy = normalizePolyModel({ ...apiChair, "Tri Count": POLY_TRI_COUNT_WARN + 1 });
	assert.match(polyHeavyModelReason(heavy), /heavy/);
	assert.equal(polyHeavyModelReason(normalizePolyModel(apiChair)), null);
	assert.equal(polyHeavyModelReason(null), null);
});

/* -------------------------------------------------------- file name ---- */

check("a title becomes a file name the studio and the OS both accept", () => {
	assert.equal(polyFileName({ title: "Chair" }), "Chair.glb");
	assert.equal(polyFileName({ title: "Office Chair 2" }), "Office Chair 2.glb");
	assert.equal(polyFileName({ title: "a/b\\c:d*e?f\"g<h>i|j" }), "a b c d e f g h i j.glb");
	assert.equal(polyFileName({ title: "   " }), "model.glb");
	assert.equal(polyFileName(null), "model.glb");
	assert.equal(polyFileName({ title: ".." }), "model.glb");
	assert.equal(polyFileName({ title: "x".repeat(300) }).length <= 84, true);
});

/* ------------------------------------------------------ fitted height ---- */

check("an explicit height wins over everything", () => {
	assert.equal(resolvePolyObjectHeight({ measured: 2, hint: 0.9, requested: 1.4 }), 1.4);
	assert.equal(resolvePolyObjectHeight({ requested: 0.05 }), 0.05);
});

check("a trusted measurement beats a category hint", () => {
	// A 2.1 m model measured from its own bounds is a door; the hint agrees.
	assert.equal(resolvePolyObjectHeight({ measured: 2.1, hint: 0.9 }), 2.1);
});

check("the 1 m import fallback is replaced by the category hint", () => {
	// Exactly 1.000 m is what fitMeshBounds produces when a file is authored in
	// centimetres or city units — it is a fallback, not a measurement.
	assert.equal(resolvePolyObjectHeight({ measured: 1, hint: 0.9 }), 0.9);
	assert.equal(resolvePolyObjectHeight({ measured: 1, hint: null }), 1);
	assert.equal(resolvePolyObjectHeight({}), 1);
});

/* ----------------------------------------------------------- download ---- */

await checkAsync("a downloaded model arrives as bytes with a .glb name", async () => {
	const seen = [];
	const fetchImpl = async (url) => {
		seen.push(url);
		return { ok: true, status: 200, headers: new Map([["content-length", "4"]]), arrayBuffer: async () => new ArrayBuffer(4) };
	};
	const result = await downloadPolyModel(normalizePolyModel(apiChair), { fetchImpl });
	assert.equal(seen[0], apiChair.Download);
	assert.equal(result.name, "Chair.glb");
	assert.equal(result.type, "model/gltf-binary");
	assert.equal(result.bytes.byteLength, 4);
});

await checkAsync("a model larger than the studio's ceiling is refused", async () => {
	const fetchImpl = async () => ({ ok: true, status: 200, headers: new Map([["content-length", "999999"]]), arrayBuffer: async () => new ArrayBuffer(999999) });
	await assert.rejects(() => downloadPolyModel(normalizePolyModel(apiChair), { fetchImpl, maxBytes: 1024 }), /larger than this studio can import/);
});

await checkAsync("a file that arrives over the ceiling is refused even when no length was declared", async () => {
	const fetchImpl = async () => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(2048) });
	await assert.rejects(() => downloadPolyModel(normalizePolyModel(apiChair), { fetchImpl, maxBytes: 1024 }), /larger than this studio can import/);
});

await checkAsync("an empty or failed download says which it was", async () => {
	const empty = async () => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) });
	await assert.rejects(() => downloadPolyModel(normalizePolyModel(apiChair), { fetchImpl: empty }), /empty/);
	const failed = async () => ({ ok: false, status: 403, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(1) });
	await assert.rejects(() => downloadPolyModel(normalizePolyModel(apiChair), { fetchImpl: failed }), /403/);
	await assert.rejects(() => downloadPolyModel(null, { fetchImpl: failed }), /no file to download/);
});

/* --------------------------------------------------------------- search ---- */

const jsonResponse = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
});

await checkAsync("a search reads the sidecar path and returns ranked models", async () => {
	const seen = [];
	const fetchImpl = async (url) => {
		seen.push(url);
		return jsonResponse({ total: 262, results: [apiChair] });
	};
	const result = await searchPolyModels("chair", { fetchImpl });
	assert.equal(seen[0].startsWith("/agent/poly/search/chair?"), true, seen[0]);
	assert.equal(result.source, "sidecar");
	assert.equal(result.total, 262);
	assert.equal(result.models.length, 1);
	assert.equal(result.reason, null);
});

await checkAsync("a sidecar that has no key explains itself instead of failing blankly", async () => {
	const fetchImpl = async () => jsonResponse({ error: "Poly Pizza is not configured: set POLY_PIZZA_API_KEY." }, 503);
	const result = await searchPolyModels("chair", { fetchImpl });
	assert.equal(result.source, "none");
	assert.deepEqual([...result.models], []);
	assert.match(result.reason, /POLY_PIZZA_API_KEY/);
});

await checkAsync("an unreachable sidecar does not throw into the panel", async () => {
	const result = await searchPolyModels("chair", { fetchImpl: async () => { throw new Error("network down"); } });
	assert.equal(result.source, "none");
	assert.match(result.reason, /network down/);
});

await checkAsync("a non-JSON answer is reported, not parsed as a result", async () => {
	const result = await searchPolyModels("chair", { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }) });
	assert.equal(result.source, "none");
	assert.match(result.reason, /unreadable/);
});

await checkAsync("an empty search term never reaches the network", async () => {
	let called = false;
	const fetchImpl = async () => { called = true; return jsonResponse({}); };
	const result = await searchPolyModels("  ", { fetchImpl });
	assert.equal(called, false);
	assert.equal(result.models.length, 0);
});

await checkAsync("search results are ranked before the caller sees them", async () => {
	const fetchImpl = async () => jsonResponse({ total: 2, results: [
		{ ...apiChair, ID: "reserved", Licence: "All rights reserved", "Tri Count": 10 },
		{ ...apiChair, ID: "cc0" },
	] });
	const result = await searchPolyModels("chair", { fetchImpl });
	assert.equal(result.models[0].id, "cc0");
});

console.log(`poly-pizza: ${checks.length} checks passed`);
