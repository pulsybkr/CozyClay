#!/usr/bin/env node
/**
 * The packaged launcher serves the 3D library.
 *
 * The library was mounted in `tools/dev-full.mjs` and NOT in `bin/cozyclay.mjs`,
 * which is the process a user actually runs. That is the worst shape a bug can
 * take: every check passed in development and the feature was missing in the
 * build. So this suite starts the REAL launcher and asks it for the route.
 *
 * It also proves the two properties that matter with no key configured: the
 * route answers a sentence naming the variable to set, rather than 404 (not
 * mounted) or 500 (crash), and it never leaks the key it was given.
 *
 * Every case asks the OS for a FREE port. A fixed port made an earlier version
 * of this suite lie: a launcher from a previous run was still listening, the
 * readiness probe connected to THAT process, and the checks passed against a
 * build that had the route while the one under test did not.
 */
import assert from "node:assert/strict";
import { createServer } from "node:net";

import { spawnOwned, terminateOwned } from "../../tools/process-supervisor.mjs";

/** The variable the sidecar reads for the library's credential. */
const KEY_VARIABLE = "POLY_PIZZA_API_KEY";
/**
 * A placeholder, not a credential: it must look like a key so the route takes
 * its "configured" branch, and it must be recognisable as a fixture so nobody
 * mistakes this file for a place a real key belongs.
 */
const PLACEHOLDER_KEY = ["not", "a", "real", "credential"].join("-");

const checks = [];
const checkAsync = async (name, fn) => { await fn(); checks.push(name); };

/** A port the OS says is free right now. */
async function freePort() {
	const probe = createServer();
	await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
	const { port } = probe.address();
	await new Promise((resolve) => probe.close(resolve));
	return port;
}

/** The launcher's environment: the caller's own, with the one variable set. */
function launcherEnv(value) {
	const env = { ...process.env, [`${KEY_VARIABLE}`]: value };
	return env;
}

/** Wait until THIS launcher answers, or give up with what it printed. */
async function waitForServer(child, origin, output, deadlineMs = 60_000) {
	const deadline = Date.now() + deadlineMs;
	for (;;) {
		if (child.exitCode !== null || child.signalCode !== null) throw new Error(`the launcher exited before it served: ${output()}`);
		try {
			const response = await fetch(`${origin}/app/`, { signal: AbortSignal.timeout(2000) });
			if (response.ok || response.status === 404) return;
		} catch { /* still starting */ }
		if (Date.now() >= deadline) throw new Error(`the launcher never served ${origin}: ${output()}`);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

const withLauncher = async (env, body) => {
	const port = await freePort();
	const origin = `http://127.0.0.1:${port}`;
	const chunks = [];
	const child = spawnOwned(process.execPath, ["bin/cozyclay.mjs", "--host", "127.0.0.1", "--port", String(port), "--no-open", "--no-star", "--no-motion"], {
		env, stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout?.on("data", (chunk) => chunks.push(String(chunk)));
	child.stderr?.on("data", (chunk) => chunks.push(String(chunk)));
	const output = () => chunks.join("").slice(-2000);
	try {
		await waitForServer(child, origin, output);
		await body(origin);
	} finally {
		await terminateOwned(child);
	}
};

/* ------------------------------------------------ the route is mounted ---- */

await checkAsync("the packaged launcher serves the 3D library route", async () => {
	await withLauncher(launcherEnv(""), async (origin) => {
		const response = await fetch(`${origin}/agent/poly/search/chair`, { headers: { origin }, signal: AbortSignal.timeout(10_000) });
		// 404 would mean "not mounted" — the exact regression this suite exists
		// for. 503 is the honest answer of a sidecar with no key configured.
		assert.notEqual(response.status, 404, "the route must be mounted in the packaged launcher");
		assert.equal(response.status, 503, `without a key the route explains itself, got ${response.status}`);
		const body = await response.json();
		assert.match(body.error, new RegExp(KEY_VARIABLE), "the sentence names the variable to set");
	});
});

await checkAsync("a configured key takes the route past the 'not configured' branch", async () => {
	await withLauncher(launcherEnv(PLACEHOLDER_KEY), async (origin) => {
		// The upstream is the real library, so any of these proves the wiring:
		// 200 answered, 502/504 reached it and failed, 503 rate-limited.
		const response = await fetch(`${origin}/agent/poly/search/chair?limit=1`, { headers: { origin }, signal: AbortSignal.timeout(25_000) });
		assert.notEqual(response.status, 404, "the route must be mounted");
		if (response.status !== 200) {
			const body = await response.json().catch(() => ({}));
			assert.doesNotMatch(body.error ?? "", new RegExp(KEY_VARIABLE), "a configured key never takes the 'not configured' branch");
		}
	});
});

await checkAsync("the key never appears in what the route answers", async () => {
	await withLauncher(launcherEnv(PLACEHOLDER_KEY), async (origin) => {
		const response = await fetch(`${origin}/agent/poly/search/chair`, { headers: { origin }, signal: AbortSignal.timeout(20_000) });
		const text = await response.text();
		assert.equal(text.includes(PLACEHOLDER_KEY), false, "the credential must never reach the browser");
	});
});

/* -------------------------------------------------------- admission ---- */

await checkAsync("only the two library routes are served, and only as GETs", async () => {
	await withLauncher(launcherEnv(PLACEHOLDER_KEY), async (origin) => {
		for (const path of ["/agent/poly/categories", "/agent/poly/search", "/agent/poly/search/a/b", "/agent/poly/model/"]) {
			const response = await fetch(`${origin}${path}`, { headers: { origin }, signal: AbortSignal.timeout(8000) });
			assert.equal(response.status, 404, `${path} must not be served`);
		}
		const post = await fetch(`${origin}/agent/poly/search/chair`, { method: "POST", headers: { origin }, body: "{}", signal: AbortSignal.timeout(8000) });
		assert.equal(post.status, 405, "a lookup is a GET");
	});
});

console.log(`packaged launcher 3D library: ${checks.length} checks passed`);
