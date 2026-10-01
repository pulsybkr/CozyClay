/**
 * Sidecar HTTP routes mounted under /agent/source/
 * Proxies workflow connections securely without leaking credentials to browser or exports.
 */
import { allowAgentOrigin } from "./agent-routes.mjs";
import { createConnectionStore } from "./source-connections.mjs";
import { createSourceClient, SourceClientError } from "./source-client.mjs";
import * as defaultKeys from "./provider-keys.mjs";

const JSON_LIMIT = 64 * 1024; // 64 KiB for control payloads

function json(res, status, value) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(value));
}

async function readJsonBody(req, limit = JSON_LIMIT) {
	let total = 0;
	const chunks = [];
	return new Promise((resolve, reject) => {
		req.on("data", (chunk) => {
			total += chunk.length;
			if (total > limit) {
				req.destroy();
				reject(new Error("Request body too large"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolve(null);
				return;
			}
			const buf = Buffer.concat(chunks);
			try {
				resolve(JSON.parse(buf.toString("utf8")));
			} catch (err) {
				reject(new Error(`Invalid JSON body: ${err.message}`));
			}
		});
		req.on("error", reject);
	});
}

const SEGMENT_PATTERN = /^[a-zA-Z0-9_\-\.]+$/;

function isValidSegment(s) {
	if (typeof s !== "string" || s.length === 0 || s.length > 128) return false;
	if (s === "." || s === ".." || s.includes("/")) return false;
	return SEGMENT_PATTERN.test(s);
}

export function createSourceRoute({
	env = process.env,
	keys = defaultKeys,
	configStore = null,
	fetchImpl = globalThis.fetch,
	port = undefined,
} = {}) {
	const keyStore = keys || defaultKeys;
	const store = configStore || createConnectionStore({ env, keys: keyStore });
	const client = createSourceClient({ fetchImpl });

	return async function handleSourceRequest(req, res, path) {
		if (!path.startsWith("/agent/source/")) {
			return false;
		}

		if (port !== undefined && !allowAgentOrigin(req, typeof port === "function" ? port() : port)) {
			json(res, 403, { error: "forbidden origin" });
			return true;
		}

		const subPath = path.slice("/agent/source/".length);
		const method = req.method;

		// 1. GET /agent/source/connections
		if (subPath === "connections" && method === "GET") {
			try {
				const list = store.listConnections();
				json(res, 200, { connections: list });
			} catch (err) {
				json(res, 500, { error: err.message });
			}
			return true;
		}

		// 2. POST /agent/source/connections
		if (subPath === "connections" && method === "POST") {
			let body;
			try {
				body = await readJsonBody(req);
			} catch (err) {
				json(res, 400, { error: err.message });
				return true;
			}
			if (!body?.name || !body?.baseUrl) {
				json(res, 400, { error: "name and baseUrl are required" });
				return true;
			}
			try {
				const created = store.createConnection({
					name: body.name,
					baseUrl: body.baseUrl,
					credential: body.credential,
				});
				json(res, 201, created);
			} catch (err) {
				json(res, 400, { error: err.message });
			}
			return true;
		}

		// Parse subpath segments: /agent/source/connections/:id/...
		const parts = subPath.split("/").map(decodeURIComponent);
		if (parts[0] !== "connections" || parts.length < 2) {
			json(res, 404, { error: "Unknown source route" });
			return true;
		}

		const connectionId = parts[1];
		if (!isValidSegment(connectionId)) {
			json(res, 400, { error: "Invalid connection id" });
			return true;
		}

		// 3. PATCH /agent/source/connections/:id
		if (parts.length === 2 && method === "PATCH") {
			let body;
			try {
				body = await readJsonBody(req);
			} catch (err) {
				json(res, 400, { error: err.message });
				return true;
			}
			try {
				const updated = store.updateConnection(connectionId, {
					name: body?.name,
					baseUrl: body?.baseUrl,
					credential: body?.credential,
				});
				json(res, 200, updated);
			} catch (err) {
				const status = err.message.includes("not found") ? 404 : 400;
				json(res, status, { error: err.message });
			}
			return true;
		}

		// 4. DELETE /agent/source/connections/:id
		if (parts.length === 2 && method === "DELETE") {
			try {
				const removed = store.removeConnection(connectionId);
				if (!removed) {
					json(res, 404, { error: "Connection not found" });
					return true;
				}
				json(res, 200, { ok: true });
			} catch (err) {
				json(res, 400, { error: err.message });
			}
			return true;
		}

		// Resolve connection target
		const resolved = store.resolveConnection(connectionId);
		if (!resolved) {
			json(res, 404, { error: `Connection '${connectionId}' not found` });
			return true;
		}
		const { connection, apiKey } = resolved;

		// 5. POST /agent/source/connections/:id/test
		if (parts.length === 3 && parts[2] === "test" && method === "POST") {
			try {
				const result = await client.testConnection(connection.baseUrl, apiKey);
				json(res, 200, result);
			} catch (err) {
				const status = err instanceof SourceClientError ? err.status : 502;
				json(res, status, {
					ok: false,
					error: err.message,
					code: err.code || "CONNECTION_FAILED",
				});
			}
			return true;
		}

		// Upstream project routing:
		// parts[2]: "projects"
		// parts[3]: projectId
		if (parts[2] !== "projects" || parts.length < 5) {
			json(res, 404, { error: "Unknown project resource route" });
			return true;
		}

		const projectId = parts[3];
		if (!isValidSegment(projectId)) {
			json(res, 400, { error: "Invalid projectId" });
			return true;
		}

		// 6. GET /agent/source/connections/:id/projects/:projectId/manifest
		if (parts.length === 5 && parts[4] === "manifest" && method === "GET") {
			try {
				const manifest = await client.fetchManifest(connection.baseUrl, apiKey, projectId);
				json(res, 200, manifest);
			} catch (err) {
				const status = err instanceof SourceClientError ? err.status : 502;
				json(res, status, { error: err.message, code: err.code });
			}
			return true;
		}

		// Revisions sub-routes:
		// parts[4]: "revisions"
		// parts[5]: revision
		if (parts[4] !== "revisions" || parts.length < 7) {
			json(res, 404, { error: "Unknown revision route" });
			return true;
		}

		const revision = parts[5];
		if (!isValidSegment(revision)) {
			json(res, 400, { error: "Invalid revision" });
			return true;
		}

		// 7. GET /agent/source/connections/:id/projects/:projectId/revisions/:revision/manifest
		if (parts.length === 7 && parts[6] === "manifest" && method === "GET") {
			try {
				const manifest = await client.fetchRevisionManifest(connection.baseUrl, apiKey, projectId, revision);
				json(res, 200, manifest);
			} catch (err) {
				const status = err instanceof SourceClientError ? err.status : 502;
				json(res, status, { error: err.message, code: err.code });
			}
			return true;
		}

		// 8. GET /agent/source/connections/:id/projects/:projectId/revisions/:revision/snapshot
		if (parts.length === 7 && parts[6] === "snapshot" && method === "GET") {
			try {
				const snapshot = await client.fetchSnapshot(connection.baseUrl, apiKey, projectId, revision);
				json(res, 200, snapshot);
			} catch (err) {
				const status = err instanceof SourceClientError ? err.status : 502;
				json(res, status, { error: err.message, code: err.code });
			}
			return true;
		}

		// 9. GET /agent/source/connections/:id/projects/:projectId/revisions/:revision/sections/:section
		if (parts.length === 8 && parts[6] === "sections" && method === "GET") {
			const section = parts[7];
			if (!isValidSegment(section)) {
				json(res, 400, { error: "Invalid section" });
				return true;
			}
			const urlObj = new URL(req.url, "http://127.0.0.1");
			const cursor = urlObj.searchParams.get("cursor");
			const rawLimit = urlObj.searchParams.get("limit");
			let limit = 50;
			if (rawLimit) {
				const parsedLimit = parseInt(rawLimit, 10);
				if (Number.isFinite(parsedLimit) && parsedLimit > 0 && parsedLimit <= 100) {
					limit = parsedLimit;
				}
			}

			try {
				const page = await client.fetchSectionPage(connection.baseUrl, apiKey, projectId, revision, section, {
					cursor,
					limit,
				});
				json(res, 200, page);
			} catch (err) {
				const status = err instanceof SourceClientError ? err.status : 502;
				json(res, status, { error: err.message, code: err.code });
			}
			return true;
		}

		// 10. GET /agent/source/connections/:id/projects/:projectId/revisions/:revision/resources/:resourceId
		if (parts.length === 8 && parts[6] === "resources" && method === "GET") {
			const resourceId = parts[7];
			if (!isValidSegment(resourceId)) {
				json(res, 400, { error: "Invalid resourceId" });
				return true;
			}
			try {
				const upstreamRes = await client.fetchResource(connection.baseUrl, apiKey, projectId, revision, resourceId);
				const headers = {
					"cache-control": "public, max-age=3600, immutable",
				};
				const ctype = upstreamRes.headers.get("content-type");
				if (ctype) headers["content-type"] = ctype;
				const clen = upstreamRes.headers.get("content-length");
				if (clen) headers["content-length"] = clen;

				res.writeHead(200, headers);
				if (upstreamRes.body) {
					const reader = upstreamRes.body.getReader();
					req.on("close", () => {
						reader.cancel().catch(() => {});
					});
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						res.write(value);
					}
					res.end();
				} else {
					res.end();
				}
			} catch (err) {
				if (!res.headersSent) {
					const status = err instanceof SourceClientError ? err.status : 502;
					json(res, status, { error: err.message, code: err.code });
				}
			}
			return true;
		}

		json(res, 404, { error: "Unknown source endpoint" });
		return true;
	};
}
