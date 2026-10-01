import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSourceRoute } from "../bin/agent/source-routes.mjs";
import { createConnectionStore } from "../bin/agent/source-connections.mjs";

function createMockReqRes({ method = "GET", url = "/", headers = {}, body = null } = {}) {
	const reqEvents = {};
	const req = {
		method,
		url,
		headers: {
			origin: "http://127.0.0.1:5180",
			...headers,
		},
		on(event, handler) {
			reqEvents[event] = handler;
			if (event === "data" && body !== null) {
				const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
				setTimeout(() => handler(buf), 1);
			}
			if (event === "end") {
				setTimeout(() => handler(), 2);
			}
			return req;
		},
		destroy() {},
	};

	let resStatus = 200;
	let resHeaders = {};
	let resBody = "";

	const resPromise = new Promise((resolve) => {
		const res = {
			writeHead(status, headers = {}) {
				resStatus = status;
				resHeaders = { ...resHeaders, ...headers };
			},
			write(chunk) {
				resBody += chunk.toString();
			},
			end(chunk) {
				if (chunk) resBody += chunk.toString();
				resolve({
					status: resStatus,
					headers: resHeaders,
					body: resBody ? JSON.parse(resBody) : null,
				});
			},
		};
		req._res = res;
	});

	return { req, res: req._res, getResult: () => resPromise };
}

describe("source-routes", () => {
	const tempDir = mkdtempSync(join(tmpdir(), "cozyclay-source-test-"));

	const mockKeys = {
		_keys: {},
		readKeys() { return this._keys; },
		setKey(id, k) { this._keys[id] = k; return this._keys; },
		removeKey(id) { delete this._keys[id]; return this._keys; },
	};

	const store = createConnectionStore({
		configDir: tempDir,
		keys: mockKeys,
		env: {},
	});

	const mockUpstream = async (url, options) => {
		const parsed = new URL(url);
		if (parsed.pathname === "/api/studio/v1/capabilities") {
			return new Response(JSON.stringify({ schemaVersion: "cozy-story-v1", supportedSections: ["characters", "shots"], maxLimit: 100 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (parsed.pathname === "/api/studio/v1/projects/my-video/manifest") {
			return new Response(JSON.stringify({ schemaVersion: "cozy-story-v1", projectId: "my-video", revision: "r01", manifestHash: "sha256:abc" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		if (parsed.pathname === "/api/studio/v1/projects/my-video/revisions/r01/sections/characters") {
			return new Response(JSON.stringify({ section: "characters", items: [{ id: "c1", name: "Alex" }], total: 1, nextCursor: null }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
	};

	const handler = createSourceRoute({
		configStore: store,
		fetchImpl: mockUpstream,
		port: 5180,
	});

	it("rejects unauthorized origin with 403", async () => {
		const { req, res, getResult } = createMockReqRes({
			method: "GET",
			url: "/agent/source/connections",
			headers: { origin: "http://malicious.example.com" },
		});
		const handled = await handler(req, res, "/agent/source/connections");
		assert.equal(handled, true);
		const result = await getResult();
		assert.equal(result.status, 403);
		assert.equal(result.body.error, "forbidden origin");
	});

	it("creates a connection, stores secret write-only, and lists it without credential", async () => {
		// 1. Create
		const { req: req1, res: res1, getResult: getResult1 } = createMockReqRes({
			method: "POST",
			url: "/agent/source/connections",
			body: {
				name: "FastAPI Backend",
				baseUrl: "http://localhost:8000",
				credential: "super-secret-key-123",
			},
		});
		await handler(req1, res1, "/agent/source/connections");
		const created = await getResult1();
		assert.equal(created.status, 201);
		assert.equal(created.body.name, "FastAPI Backend");
		assert.equal(created.body.credentialConfigured, true);
		assert.equal(created.body.credential, undefined); // Never return secret!
		const connId = created.body.id;

		// 2. List
		const { req: req2, res: res2, getResult: getResult2 } = createMockReqRes({
			method: "GET",
			url: "/agent/source/connections",
		});
		await handler(req2, res2, "/agent/source/connections");
		const listed = await getResult2();
		assert.equal(listed.status, 200);
		assert.equal(listed.body.connections.length, 1);
		assert.equal(listed.body.connections[0].id, connId);
		assert.equal(listed.body.connections[0].credentialConfigured, true);
		assert.equal(listed.body.connections[0].credential, undefined);

		// 3. Test connection
		const { req: req3, res: res3, getResult: getResult3 } = createMockReqRes({
			method: "POST",
			url: `/agent/source/connections/${connId}/test`,
		});
		await handler(req3, res3, `/agent/source/connections/${connId}/test`);
		const testRes = await getResult3();
		assert.equal(testRes.status, 200);
		assert.equal(testRes.body.ok, true);
		assert.equal(testRes.body.schemaVersion, "cozy-story-v1");

		// 4. Fetch manifest
		const { req: req4, res: res4, getResult: getResult4 } = createMockReqRes({
			method: "GET",
			url: `/agent/source/connections/${connId}/projects/my-video/manifest`,
		});
		await handler(req4, res4, `/agent/source/connections/${connId}/projects/my-video/manifest`);
		const manifestRes = await getResult4();
		assert.equal(manifestRes.status, 200);
		assert.equal(manifestRes.body.projectId, "my-video");
		assert.equal(manifestRes.body.revision, "r01");

		// 5. Fetch section
		const { req: req5, res: res5, getResult: getResult5 } = createMockReqRes({
			method: "GET",
			url: `/agent/source/connections/${connId}/projects/my-video/revisions/r01/sections/characters`,
		});
		await handler(req5, res5, `/agent/source/connections/${connId}/projects/my-video/revisions/r01/sections/characters`);
		const secRes = await getResult5();
		assert.equal(secRes.status, 200);
		assert.equal(secRes.body.section, "characters");
		assert.equal(secRes.body.items[0].name, "Alex");

		// 6. Delete connection
		const { req: req6, res: res6, getResult: getResult6 } = createMockReqRes({
			method: "DELETE",
			url: `/agent/source/connections/${connId}`,
		});
		await handler(req6, res6, `/agent/source/connections/${connId}`);
		const delRes = await getResult6();
		assert.equal(delRes.status, 200);
		assert.equal(delRes.body.ok, true);
	});

	it("blocks invalid path traversal segments", async () => {
		const { req, res, getResult } = createMockReqRes({
			method: "GET",
			url: "/agent/source/connections/../../../etc/passwd",
		});
		await handler(req, res, "/agent/source/connections/../../../etc/passwd");
		const resData = await getResult();
		assert.equal(resData.status, 400);
		assert.equal(resData.body.error, "Invalid connection id");
	});

	it("resolves STUDIO_API_KEY and STUDIO_API_URL from environment", () => {
		const envStore = createConnectionStore({
			configDir: tempDir,
			keys: mockKeys,
			env: {
				STUDIO_API_KEY: "secret-bearer-token",
				STUDIO_API_URL: "http://127.0.0.1:8000",
			},
		});
		const list = envStore.listConnections();
		const envConn = list.find((c) => c.id === "env-default");
		assert.ok(envConn, "env-default connection should exist");
		assert.equal(envConn.credentialConfigured, true);
		assert.equal(envConn.baseUrl, "http://127.0.0.1:8000");

		const resolved = envStore.resolveConnection("env-default");
		assert.equal(resolved.apiKey, "secret-bearer-token");
	});

	it("updates existing connection credentials via PATCH", async () => {
		const postReq = createMockReqRes({
			method: "POST",
			url: "/agent/source/connections",
			body: { name: "Updatable", baseUrl: "http://127.0.0.1:8000" },
		});
		await handler(postReq.req, postReq.res, "/agent/source/connections");
		const created = (await postReq.getResult()).body;
		assert.equal(created.credentialConfigured, false);

		// Now update credentials
		const patchReq = createMockReqRes({
			method: "PATCH",
			url: `/agent/source/connections/${created.id}`,
			body: { credential: "new-secret-key" },
		});
		await handler(patchReq.req, patchReq.res, `/agent/source/connections/${created.id}`);
		const updated = (await patchReq.getResult()).body;
		assert.equal(updated.credentialConfigured, true);

		// Verify resolved apiKey
		const resolved = store.resolveConnection(created.id);
		assert.equal(resolved.apiKey, "new-secret-key");
	});
});
