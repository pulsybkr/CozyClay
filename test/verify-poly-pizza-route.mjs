#!/usr/bin/env node
/**
 * The sidecar's Poly Pizza route: path admission, key resolution, and the one
 * sentence each failure has to say. Every upstream call is injected, so this
 * suite never touches the network and never needs a key.
 */
import assert from "node:assert/strict";

import {
	POLY_KEY_ENV,
	POLY_KEY_ID,
	createPolyPizzaRoute,
	parsePolyRequest,
	resolvePolyKey,
} from "../bin/agent/poly-pizza-route.mjs";

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const checkAsync = async (name, fn) => { await fn(); checks.push(name); };

/* --------------------------------------------------------- path admission ---- */

check("the two routes the client can build are admitted", () => {
	const search = parsePolyRequest("/agent/poly/search/office%20chair", new URLSearchParams("limit=12"));
	assert.deepEqual({ kind: search.kind, term: search.term, limit: search.params.get("limit") }, { kind: "search", term: "office%20chair", limit: "12" });
	const model = parsePolyRequest("/agent/poly/model/iMNqRzPwwe", new URLSearchParams());
	assert.deepEqual({ kind: model.kind, id: model.id }, { kind: "model", id: "iMNqRzPwwe" });
});

check("an unknown route or a nested path is refused before any upstream call", () => {
	for (const path of [
		"/agent/poly/categories",
		"/agent/poly/search",
		"/agent/poly/search/a/b",
		"/agent/poly/model/",
		"/agent/poly/search/../../etc/passwd",
		"/agent/models",
	]) {
		assert.equal(parsePolyRequest(path, new URLSearchParams()), null, path);
	}
});

check("only limit and page survive from the query string", () => {
	const parsed = parsePolyRequest("/agent/poly/search/chair", new URLSearchParams("limit=5&page=2&key=stolen&evil=1"));
	assert.deepEqual([...parsed.params.entries()].sort(), [["limit", "5"], ["page", "2"]]);
});

/* --------------------------------------------------------------- key ---- */

check("the environment wins over the saved file", () => {
	assert.deepEqual(resolvePolyKey({ env: { [POLY_KEY_ENV]: "env-key" }, saved: { [POLY_KEY_ID]: "file-key" } }), { key: "env-key", source: "env" });
});

check("a saved key is used when the environment says nothing", () => {
	assert.deepEqual(resolvePolyKey({ env: {}, saved: { [POLY_KEY_ID]: "file-key" } }), { key: "file-key", source: "file" });
});

check("no key at all is an explicit state, not an empty string", () => {
	assert.deepEqual(resolvePolyKey({ env: {}, saved: {} }), { key: null, source: null });
	assert.deepEqual(resolvePolyKey({ env: { [POLY_KEY_ENV]: "   " }, saved: { [POLY_KEY_ID]: "" } }), { key: null, source: null });
	assert.deepEqual(resolvePolyKey(), { key: null, source: null });
});

/* -------------------------------------------------------------- route ---- */

/** A minimal response double, the same shape `agent-routes.mjs` writes to. */
function response() {
	return {
		statusCode: null,
		headers: null,
		body: "",
		writeHead(status, headers) { this.statusCode = status; this.headers = headers; return this; },
		end(body) { this.body = body ?? ""; return this; },
		json() { return JSON.parse(this.body); },
	};
}
const request = (method = "GET", url = "/agent/poly/search/chair") => ({ method, url, headers: { origin: "http://127.0.0.1:5180" } });
const okJson = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

await checkAsync("a route that is not ours is declined, not answered", async () => {
	const res = response();
	const handled = await createPolyPizzaRoute({}) (request("GET", "/agent/models"), res, "/agent/models");
	assert.equal(handled, false);
	assert.equal(res.statusCode, null);
});

await checkAsync("without a key the panel is told exactly what to set", async () => {
	const res = response();
	const handled = await createPolyPizzaRoute({ env: {}, keys: { readKeys: () => ({}) } })(request(), res, "/agent/poly/search/chair");
	assert.equal(handled, true);
	assert.equal(res.statusCode, 503);
	assert.match(res.json().error, new RegExp(POLY_KEY_ENV));
	assert.match(res.json().error, new RegExp(POLY_KEY_ID));
});

await checkAsync("a configured key is sent upstream and never echoed back", async () => {
	const seen = [];
	const res = response();
	const route = createPolyPizzaRoute({
		env: { [POLY_KEY_ENV]: "secret-key-value" },
		keys: { readKeys: () => ({}) },
		fetchImpl: async (url, init) => { seen.push({ url, init }); return okJson({ total: 1, results: [] }); },
	});
	await route(request(), res, "/agent/poly/search/office%20chair");
	assert.equal(res.statusCode, 200);
	assert.equal(seen[0].url, "https://api.poly.pizza/v1.1/search/office%20chair");
	assert.equal(seen[0].init.headers["x-auth-token"], "secret-key-value");
	assert.equal(res.body.includes("secret-key-value"), false, "the key must never reach the browser");
});

await checkAsync("a model lookup addresses the model route upstream", async () => {
	const seen = [];
	const route = createPolyPizzaRoute({ env: { [POLY_KEY_ENV]: "k" }, fetchImpl: async (url) => { seen.push(url); return okJson({ ID: "iMNqRzPwwe" }); } });
	await route(request("GET", "/agent/poly/model/iMNqRzPwwe"), response(), "/agent/poly/model/iMNqRzPwwe");
	assert.equal(seen[0], "https://api.poly.pizza/v1.1/model/iMNqRzPwwe");
});

await checkAsync("a rejected key says so instead of 'failed'", async () => {
	const res = response();
	const route = createPolyPizzaRoute({ env: { [POLY_KEY_ENV]: "k" }, fetchImpl: async () => ({ ok: false, status: 401, text: async () => "" }) });
	await route(request(), res, "/agent/poly/search/chair");
	assert.equal(res.statusCode, 502);
	assert.match(res.json().error, /refused that API key/);
});

await checkAsync("rate limiting is reported as temporary, not as a breakage", async () => {
	const res = response();
	const route = createPolyPizzaRoute({ env: { [POLY_KEY_ENV]: "k" }, fetchImpl: async () => ({ ok: false, status: 429, text: async () => "" }) });
	await route(request(), res, "/agent/poly/search/chair");
	assert.equal(res.statusCode, 503);
	assert.match(res.json().error, /rate-limiting/);
});

await checkAsync("a network failure and a timeout read differently", async () => {
	const down = response();
	await createPolyPizzaRoute({ env: { [POLY_KEY_ENV]: "k" }, fetchImpl: async () => { throw new Error("ENOTFOUND"); } })(request(), down, "/agent/poly/search/chair");
	assert.match(down.json().error, /could not be reached/);

	const aborted = response();
	const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
	await createPolyPizzaRoute({ env: { [POLY_KEY_ENV]: "k" }, fetchImpl: async () => { throw abort; } })(request(), aborted, "/agent/poly/search/chair");
	assert.match(aborted.json().error, /did not answer in time/);
});

await checkAsync("an HTML error page returned with status 200 is not passed off as results", async () => {
	const res = response();
	const route = createPolyPizzaRoute({ env: { [POLY_KEY_ENV]: "k" }, fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<!doctype html><h1>maintenance</h1>" }) });
	await route(request(), res, "/agent/poly/search/chair");
	assert.equal(res.statusCode, 502);
	assert.match(res.json().error, /unreadable/);
});

await checkAsync("a response larger than the studio will read is refused", async () => {
	const res = response();
	const route = createPolyPizzaRoute({ env: { [POLY_KEY_ENV]: "k" }, fetchImpl: async () => ({ ok: true, status: 200, text: async () => "x".repeat(1_000_001) }) });
	await route(request(), res, "/agent/poly/search/chair");
	assert.equal(res.statusCode, 502);
	assert.match(res.json().error, /more than this studio will read/);
});

await checkAsync("two searches inside the debounce window: the second is held back", async () => {
	let now = 1_000_000;
	let calls = 0;
	const route = createPolyPizzaRoute({ env: { [POLY_KEY_ENV]: "k" }, clock: () => now, fetchImpl: async () => { calls += 1; return okJson({ total: 0, results: [] }); } });
	await route(request(), response(), "/agent/poly/search/chair");
	const second = response();
	now += 50;
	await route(request(), second, "/agent/poly/search/chair");
	assert.equal(calls, 1, "the upstream was called once");
	assert.equal(second.statusCode, 429);
	now += 1_000;
	const third = response();
	await route(request(), third, "/agent/poly/search/chair");
	assert.equal(calls, 2, "a later search goes through");
	assert.equal(third.statusCode, 200);
});

await checkAsync("a non-GET is refused without touching the upstream", async () => {
	let calls = 0;
	const res = response();
	await createPolyPizzaRoute({ env: { [POLY_KEY_ENV]: "k" }, fetchImpl: async () => { calls += 1; return okJson({}); } })(request("POST"), res, "/agent/poly/search/chair");
	assert.equal(res.statusCode, 405);
	assert.equal(calls, 0);
});

await checkAsync("a broken providers.json does not take the search down with it", async () => {
	const res = response();
	const route = createPolyPizzaRoute({ env: {}, keys: { readKeys: () => { throw new Error("corrupt"); } } });
	await route(request(), res, "/agent/poly/search/chair");
	assert.equal(res.statusCode, 503);
	assert.match(res.json().error, new RegExp(POLY_KEY_ENV));
});

console.log(`poly-pizza-route: ${checks.length} checks passed`);
