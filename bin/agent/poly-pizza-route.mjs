/**
 * Poly Pizza through the sidecar, because the browser cannot call it directly.
 *
 * `api.poly.pizza` answers without `access-control-allow-origin`, so a page
 * cannot read the response at all — key or no key. That is a gift, not an
 * obstacle: it forces the credential to stay in the local sidecar, exactly
 * where every other provider key already lives, and it keeps the studio's
 * "the browser never holds a credential" rule intact (`agent-client.js` pins
 * that rule by grepping its own source).
 *
 * The GLB files themselves DO send `access-control-allow-origin: *`, so the
 * editor downloads a chosen model straight from `static.poly.pizza`; only the
 * search and lookup calls come through here.
 *
 * Key resolution mirrors the other providers: an environment variable first
 * (`POLY_PIZZA_API_KEY`), then `providers.json` under the id `poly-pizza`.
 */
import { POLY_API_BASE } from "../../src/poly-pizza.js";

/** The sidecar's bound on one upstream call. Poly Pizza answers in well under
 * a second; a hung socket must not hold a panel spinner open forever. */
const POLY_TIMEOUT_MS = 8_000;
/** Poly Pizza documents 100 requests/minute. A runaway loop would earn a 429
 * for the user's whole IP, so a search is debounced here as well as in the UI. */
const MIN_INTERVAL_MS = 250;
/** Upstream payloads are small (20 rows of ~600 bytes), but never trust that. */
const MAX_RESPONSE_BYTES = 1_000_000;

export const POLY_KEY_ID = "poly-pizza";
export const POLY_KEY_ENV = "POLY_PIZZA_API_KEY";

const NO_KEY_MESSAGE = `Poly Pizza is not configured: set ${POLY_KEY_ENV} or save a key for "${POLY_KEY_ID}".`;

/** `/agent/poly/search/office%20chair?limit=12` -> `search/office%20chair`.
 * Only the two shapes the client can build are admitted; anything else is a
 * 404 rather than a path handed to the upstream host. */
export function parsePolyRequest(path, search) {
	const rest = path.slice("/agent/poly/".length);
	const [kind, ...segments] = rest.split("/");
	if (kind !== "search" && kind !== "model") return null;
	const value = segments.join("/");
	if (!value || segments.length !== 1) return null;
	if (kind === "model") return { kind, id: value, params: new URLSearchParams() };
	const params = new URLSearchParams();
	for (const name of ["limit", "page"]) {
		const raw = search.get(name);
		if (raw !== null) params.set(name, raw);
	}
	return { kind, term: value, params };
}

export function resolvePolyKey({ env = {}, saved = {} } = {}) {
	const fromEnv = typeof env?.[POLY_KEY_ENV] === "string" ? env[POLY_KEY_ENV].trim() : "";
	if (fromEnv) return { key: fromEnv, source: "env" };
	const fromFile = typeof saved?.[POLY_KEY_ID] === "string" ? saved[POLY_KEY_ID].trim() : "";
	if (fromFile) return { key: fromFile, source: "file" };
	return { key: null, source: null };
}

function upstreamUrl(request) {
	const base = `${POLY_API_BASE}/${request.kind}/`;
	if (request.kind === "model") return `${base}${request.id}`;
	const query = request.params.toString();
	return `${base}${request.term}${query ? `?${query}` : ""}`;
}

/**
 * A short, useful sentence per failure mode. The upstream 401/403 usually means
 * a revoked key, and saying so is the difference between a user fixing it in a
 * minute and a user giving up; the key itself never appears in any of these.
 */
function failureFor(status) {
	if (status === 401 || status === 403) return { status: 502, error: "Poly Pizza refused that API key — check it is still valid." };
	if (status === 404) return { status: 404, error: "The 3D library did not find that model." };
	if (status === 429) return { status: 503, error: "Poly Pizza is rate-limiting this machine — wait a moment and search again." };
	return { status: 502, error: `The 3D library answered ${status}.` };
}

/**
 * One route handler in the shape `agent-routes.mjs` already uses: it answers
 * `true` when it owned the request and `false` to let the caller continue.
 */
export function createPolyPizzaRoute({ env = process.env, keys = null, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
	let lastCallAt = 0;
	return async function handlePolyRequest(req, res, path) {
		if (!path.startsWith("/agent/poly/")) return false;
		const write = (status, value) => {
			res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
			res.end(JSON.stringify(value));
		};
		if (req.method !== "GET") { write(405, { error: "Poly Pizza lookups are GETs." }); return true; }
		const search = new URL(req.url, "http://127.0.0.1").searchParams;
		const request = parsePolyRequest(path, search);
		if (!request) { write(404, { error: "Unknown 3D library route." }); return true; }

		let saved = {};
		try { saved = keys?.readKeys?.() ?? {}; } catch { saved = {}; }
		const { key } = resolvePolyKey({ env, saved });
		if (!key) { write(503, { error: NO_KEY_MESSAGE }); return true; }

		const now = Number(clock()) || 0;
		if (now && lastCallAt && now - lastCallAt < MIN_INTERVAL_MS) {
			write(429, { error: "One search at a time, please." });
			return true;
		}
		lastCallAt = now;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), POLY_TIMEOUT_MS);
		const onReqClose = () => {
			if (!controller.signal.aborted) controller.abort();
		};
		if (typeof req.on === "function") req.on("close", onReqClose);

		let response;
		try {
			const upstream = upstreamUrl(request);
			if (!upstream.startsWith(POLY_API_BASE)) {
				write(400, { error: "Invalid upstream URL." });
				return true;
			}
			response = await fetchImpl(upstream, {
				signal: controller.signal,
				headers: { "x-auth-token": key, accept: "application/json" },
			});
			if (!response?.ok) {
				const failure = failureFor(response?.status ?? 502);
				write(failure.status, { error: failure.error });
				return true;
			}

			let text;
			if (response.body && typeof response.body.getReader === "function") {
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let receivedBytes = 0;
				let chunks = "";
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					receivedBytes += value.byteLength;
					if (receivedBytes > MAX_RESPONSE_BYTES) {
						await reader.cancel();
						write(502, { error: "The 3D library sent more than this studio will read at once." });
						return true;
					}
					chunks += decoder.decode(value, { stream: true });
				}
				chunks += decoder.decode();
				text = chunks;
			} else {
				text = await response.text();
				if (text.length > MAX_RESPONSE_BYTES) {
					write(502, { error: "The 3D library sent more than this studio will read at once." });
					return true;
				}
			}

			try {
				write(200, JSON.parse(text));
			} catch {
				write(502, { error: "The 3D library sent an unreadable answer." });
			}
			return true;
		} catch (error) {
			if (error?.name === "AbortError" || controller.signal.aborted) {
				write(504, { error: "Poly Pizza did not answer in time." });
				return true;
			}
			write(502, { error: "Poly Pizza could not be reached." });
			return true;
		} finally {
			clearTimeout(timer);
			if (typeof req.removeListener === "function") req.removeListener("close", onReqClose);
		}
	};
}
