/**
 * Poly Pizza: find a 3D model instead of authoring one.
 *
 * A chair, a couch, a traffic cone — props whose modelling time is real and
 * whose result is generic belong in the set as a download. Authoring them with
 * primitives costs a long agent turn and still looks like a box; a CC0 chair is
 * a request away. Everything this file does is pure: build the two API paths,
 * repair a response into the one shape the studio speaks, and hand back the
 * attribution its licence obliges us to show. No fetch, no credential, no
 * Node — the browser and the sidecar both import it.
 *
 * The API key is deliberately absent here. `api.poly.pizza` answers a browser
 * preflight without `access-control-allow-origin`, so a page cannot read that
 * response at all, key or no key; the search therefore goes through the local
 * sidecar, which is also the only place a credential may live. The GLB files
 * themselves DO send `access-control-allow-origin: *`, which is what lets the
 * editor download a chosen model directly.
 */

export const POLY_API_BASE = "https://api.poly.pizza/v1.1";
/** Human-facing page for a model, what the licence wants linked. */
export const POLY_MODEL_PAGE = "https://poly.pizza/m/";
/** Poly Pizza's own default; the API caps a page at 20. */
export const POLY_SEARCH_DEFAULT_LIMIT = 12;
export const POLY_SEARCH_MAX_LIMIT = 20;
/** Deep enough to page, shallow enough that a runaway loop cannot hammer a
 * 100 requests/minute budget. */
export const POLY_SEARCH_MAX_PAGE = 5;

/** Where a search came from, so the UI can say why it is empty. */
export const POLY_SOURCES = Object.freeze(["sidecar", "none"]);

const MAX_TITLE = 120;
const MAX_TEXT = 400;

function text(value, max = MAX_TEXT) {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function httpUrl(value) {
	const raw = text(value, 2048);
	if (!raw) return "";
	try {
		const url = new URL(raw);
		return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
	} catch {
		return "";
	}
}

/**
 * A licence line is the one field we cannot invent: CC-BY without attribution
 * is a licence breach, and a model with no licence stated is not safely
 * shippable. So an unreadable licence is kept as "Unknown" rather than
 * defaulted to something permissive, and `polyLicenseAllows` refuses it.
 */
export function polyLicenseOf(raw) {
	const declared = text(raw?.Licence ?? raw?.license, 60);
	if (!declared) return { id: "unknown", label: "Unknown", url: "", allows: false, requiresAttribution: true };
	const normalized = declared.toLowerCase().replace(/\s+/g, "");
	if (normalized.startsWith("cc0") || normalized.startsWith("publicdomain")) {
		return { id: "cc0", label: declared, url: "https://creativecommons.org/publicdomain/zero/1.0/", allows: true, requiresAttribution: false };
	}
	if (normalized.startsWith("cc-by")) {
		// "CC-BY 3.0" / "CC-BY 4.0" both land on the versioned deed when the
		// record states one, and on the unversioned deed when it does not.
		const version = normalized.match(/cc-by(-sa)?-?(\d+(?:\.\d+)?)/)?.[2];
		const shareAlike = normalized.includes("cc-by-sa") || normalized.includes("sharealike");
		const deed = shareAlike ? "by-sa" : "by";
		return {
			id: shareAlike ? "cc-by-sa" : "cc-by",
			label: declared,
			url: version ? `https://creativecommons.org/licenses/${deed}/${version}/` : `https://creativecommons.org/licenses/${deed}/`,
			allows: !shareAlike,
			requiresAttribution: true,
		};
	}
	// Anything else — a no-derivatives, a bare link — is carried through
	// verbatim and refused, because the set is a derivative work.
	return { id: "other", label: declared, url: "", allows: false, requiresAttribution: true };
}

export const polyLicenseAllows = (model) => Boolean(model?.license?.allows);

/**
 * The attribution string the licence asks for. Poly Pizza publishes one; when a
 * record lacks it we compose the equivalent from creator, title, id and
 * licence, because "we could not read the field" is not a reason to leave a
 * CC-BY model uncredited.
 */
export function polyAttributionLine(model) {
	if (!model) return "";
	const published = text(model.attribution, 400);
	if (published) return published;
	const title = model.title || "Untitled";
	const creator = model.creator || "Unknown creator";
	const page = model.sourceUrl || `${POLY_MODEL_PAGE}${model.id}`;
	const licence = model.license?.label || "Unknown licence";
	return `"${title}" by ${creator}, ${page}. Licence: ${licence}`;
}

/**
 * One API record as the studio's own shape. Returns null when the record has
 * no id or no downloadable model — a result the user cannot act on is worse
 * than an absent row, and the caller's list stays honest either way.
 *
 * `Tri Count` is advisory only: some creators upload without it and the API
 * answers 0, which must not read as "free". `Animated` is carried because an
 * animated GLB is dropped in at its bind pose, and the user should be told.
 */
export function normalizePolyModel(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const id = text(raw.ID ?? raw.id, 64);
	if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
	const downloadUrl = httpUrl(raw.Download ?? raw.download);
	if (!downloadUrl) return null;
	const title = text(raw.Title ?? raw.title, MAX_TITLE) || id;
	const triCount = Number(raw["Tri Count"] ?? raw.triCount);
	const creator = text(raw?.Creator?.Username ?? raw.creator, 80);
	const creatorUrl = httpUrl(raw?.Creator?.DPURL);
	return Object.freeze({
		id,
		title,
		description: text(raw.Description ?? raw.description),
		creator,
		creatorUrl,
		license: polyLicenseOf(raw),
		attribution: text(raw.Attribution ?? raw.attribution, 400),
		thumbnailUrl: httpUrl(raw.Thumbnail ?? raw.thumbnail),
		downloadUrl,
		triCount: Number.isFinite(triCount) && triCount > 0 ? Math.round(triCount) : null,
		category: text(raw.Category ?? raw.category, 80),
		tags: Object.freeze((Array.isArray(raw.Tags ?? raw.tags) ? (raw.Tags ?? raw.tags) : []).map((tag) => text(tag, 40)).filter(Boolean).slice(0, 12)),
		animated: (raw.Animated ?? raw.animated) === true,
		sourceUrl: `${POLY_MODEL_PAGE}${id}`,
	});
}

/** Every usable row of a search payload, in the order the API ranked them. */
export function normalizePolySearch(payload) {
	const results = Array.isArray(payload?.results) ? payload.results : [];
	const models = results.map(normalizePolyModel).filter(Boolean);
	const total = Number(payload?.total);
	return Object.freeze({
		total: Number.isFinite(total) && total >= 0 ? Math.round(total) : models.length,
		models: Object.freeze(models),
	});
}

/**
 * A filesystem-safe file name for a downloaded model. The name is what a mesh
 * object displays and what ".glb" keys off downstream, so a title full of
 * punctuation must still produce a name the studio and the OS both accept.
 */
export function polyFileName(model) {
	const base = text(model?.title, MAX_TITLE)
		.replace(/[\\/:*?"<>|]+/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[. ]+|[. ]+$/g, "")
		.slice(0, 80);
	return `${base || "model"}.glb`;
}

/**
 * Fit the two heights we have to the one the set should use.
 *
 * `measured` is the file's own box, already put through the import heuristic —
 * which FALLS BACK to exactly 1 m whenever the file is authored in centimetres
 * or city units, because outside 0.05–10 m the geometry is not trusted at all.
 * A 1.000 m model is therefore either genuinely one metre tall or a file that
 * told us nothing, and in both cases a category hint from the search ("chair"
 * -> 0.9 m) is the better number. An explicit request always wins over both,
 * and a trusted measurement always wins over a hint.
 */
export function resolvePolyObjectHeight({ measured, hint, requested } = {}) {
	const asked = Number(requested);
	if (Number.isFinite(asked) && asked > 0) return asked;
	const measuredHeight = Number(measured);
	const hinted = Number(hint);
	const measuredIsFallback = !Number.isFinite(measuredHeight) || Math.abs(measuredHeight - 1) < 1e-6;
	if (measuredIsFallback && Number.isFinite(hinted) && hinted > 0) return hinted;
	return Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : (Number.isFinite(hinted) && hinted > 0 ? hinted : 1);
}

/**
 * Fetch the model file itself. Poly Pizza's CDN sends
 * `access-control-allow-origin: *`, which is what makes this the one call the
 * browser can make on its own — and why the key never has to leave the sidecar.
 *
 * The ceiling is the studio's own: bytes past `ASSET_MAX_SOURCE_BYTES` could
 * never be imported anyway, and refusing them here says so before the download
 * finishes instead of after.
 */
export async function downloadPolyModel(model, { fetchImpl = globalThis.fetch, maxBytes, signal } = {}) {
	if (!model?.downloadUrl) throw new Error("that model has no file to download");
	if (typeof fetchImpl !== "function") throw new Error("no fetch available");
	const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : null;
	const response = await fetchImpl(model.downloadUrl, { signal });
	if (!response?.ok) throw new Error(`the model file could not be downloaded (${response?.status ?? "no response"})`);
	// A declared length over the ceiling is refused before a byte is buffered.
	const declared = Number(response.headers?.get?.("content-length"));
	if (limit && Number.isFinite(declared) && declared > limit) throw new Error("that model is larger than this studio can import");
	const bytes = await response.arrayBuffer();
	if (limit && bytes.byteLength > limit) throw new Error("that model is larger than this studio can import");
	if (!bytes.byteLength) throw new Error("that model file is empty");
	return { bytes, name: polyFileName(model), type: "model/gltf-binary" };
}

/**
 * The API path for a search: `/<term>?limit=&page=`.
 *
 * The term is one path segment on purpose — a space, a slash or a `..` in it
 * must address nothing but a search for those characters, never another route
 * on the upstream host.
 */
export function polySearchPath(query, { limit = POLY_SEARCH_DEFAULT_LIMIT, page } = {}) {
	const clean = text(query, 120);
	if (!clean) throw new Error("a search needs words");
	const boundedLimit = Math.min(POLY_SEARCH_MAX_LIMIT, Math.max(1, Math.round(Number(limit) || POLY_SEARCH_DEFAULT_LIMIT)));
	// The API takes the term as a path segment: a space or a slash in it would
	// address a different route rather than search for it.
	const encoded = encodeURIComponent(clean).replaceAll("%2F", "%252F");
	const params = new URLSearchParams({ limit: String(boundedLimit) });
	if (page !== undefined) {
		const boundedPage = Math.min(POLY_SEARCH_MAX_PAGE, Math.max(1, Math.round(Number(page) || 1)));
		params.set("page", String(boundedPage));
	}
	return `/search/${encoded}?${params.toString()}`;
}

export function polyModelPath(id) {
	const clean = text(id, 64);
	if (!clean) throw new Error("a model needs an id");
	return `/model/${encodeURIComponent(clean)}`;
}

/**
 * A per-triangle sanity check before a download is even attempted. The set is
 * authored on a laptop and exported frame by frame; a 500k-triangle scanned
 * couch is a stall, not a prop. The threshold is deliberately generous — it
 * exists to stop the pathological case, not to police quality.
 */
export const POLY_TRI_COUNT_WARN = 120_000;

export function polyHeavyModelReason(model) {
	if (!model) return null;
	const limit = model.triCount;
	if (!Number.isFinite(limit) || limit <= POLY_TRI_COUNT_WARN) return null;
	return `${model.title} is ${limit.toLocaleString("en-US")} triangles — heavy for a browser set; prefer a lighter model or expect a slow import.`;
}

/**
 * A starting height in metres per category, for the agent to seed
 * `asset.import({ height })` with. Ratios are what the user actually asked to
 * respect: a downloaded chair and a downloaded door must not arrive the same
 * size. A hint is not a measurement — the file's own bounds win when the two
 * disagree, which is why the caller passes it as `height` only deliberately.
 */
const HEIGHT_HINTS = [
	[/door|gateway|entrance|archway/i, 2.05],
	[/wardrobe|closet|cabinet|bookshelf|shelf|locker/i, 1.9],
	[/lamp|sconce|chandelier|lantern/i, 1.6],
	[/tree|plant|bush|shrub|flower/i, 1.5],
	[/fridge|refrigerator/i, 1.8],
	[/street ?light|traffic ?light|sign|signpost|post/i, 2.4],
	[/table|desk|counter|bench/i, 0.75],
	[/chair|stool|seat/i, 0.9],
	[/sofa|couch|armchair/i, 0.85],
	[/bed|mattress/i, 0.6],
	[/car|van|truck|bus|vehicle/i, 1.5],
	[/crate|box|chest|basket|bin|trash/i, 0.7],
	[/barrel|drum|keg/i, 0.9],
	[/cone|pylon/i, 0.7],
];

export function polyHeightHint(model) {
	if (!model) return null;
	const haystack = [model.title, model.category, ...(model.tags ?? [])].join(" ");
	for (const [pattern, height] of HEIGHT_HINTS) if (pattern.test(haystack)) return height;
	return null;
}

/**
 * Rank results the way the studio wants them: a usable licence first, then a
 * weight a laptop can carry, then closer title matches. The API's own order is
 * relevance, which happily puts a 300k-triangle CC-BY model above the CC0 one
 * that would have worked.
 */
export function rankPolyModels(models, query = "") {
	const words = text(query, 120).toLowerCase().split(/\s+/).filter(Boolean);
	const score = (model) => {
		let value = 0;
		if (polyLicenseAllows(model)) value += 1000;
		if (!model.animated) value += 50;
		if (Number.isFinite(model.triCount)) value -= Math.min(500, model.triCount / 1000);
		const title = model.title.toLowerCase();
		for (const word of words) if (title.includes(word)) value += 20;
		// Exact title beats a longer phrase containing it.
		if (words.length && title === words.join(" ")) value += 40;
		return value;
	};
	return Object.freeze([...models].sort((a, b) => score(b) - score(a)));
}

/**
 * The editor calls this through its own origin. The sidecar owns the key and
 * the upstream call; the browser never sees either. `fetchImpl` is injectable
 * so the node tests drive the whole path without a network.
 */
export async function searchPolyModels(query, { limit, page, fetchImpl = globalThis.fetch, signal } = {}) {
	// An empty box is not an error the panel should show: it is a search that
	// has not been asked yet. Only a real term may throw out of the path builder.
	if (!text(query, 120)) return { source: "none", total: 0, models: [], reason: null, empty: true };
	if (typeof fetchImpl !== "function") return { source: "none", total: 0, models: [], reason: "no fetch available" };
	const path = polySearchPath(query, { limit, page });
	let response;
	try {
		response = await fetchImpl(`/agent/poly${path}`, { signal, headers: { accept: "application/json" } });
	} catch (error) {
		return { source: "none", total: 0, models: [], reason: error?.message || "the library could not be reached" };
	}
	if (!response?.ok) {
		// The sidecar answers 503 with a reason when no key is configured, and
		// that sentence is the only actionable thing a signed-out user can read.
		let reason = `library search failed (${response?.status ?? "no response"})`;
		try {
			const body = await response.json();
			if (typeof body?.error === "string" && body.error) reason = body.error;
		} catch { /* a non-JSON body leaves the status sentence in place */ }
		return { source: "none", total: 0, models: [], reason };
	}
	let payload;
	try {
		payload = await response.json();
	} catch {
		return { source: "none", total: 0, models: [], reason: "the library answered with something unreadable" };
	}
	const normalized = normalizePolySearch(payload);
	const models = rankPolyModels(normalized.models, query);
	return { source: "sidecar", total: normalized.total, models, reason: null };
}

/**
 * A downloaded model as the `credit` an object carries. Kept as its own
 * function because the mesh object record, the inspector and the attribution
 * export must all agree on the same five fields.
 */
export function polyCredit(model) {
	if (!model) return null;
	return Object.freeze({
		library: "poly.pizza",
		id: model.id,
		title: model.title,
		creator: model.creator,
		license: model.license?.label || "Unknown",
		licenseUrl: model.license?.url ?? "",
		sourceUrl: model.sourceUrl,
		attribution: polyAttributionLine(model),
		downloadedAt: null,
	});
}
