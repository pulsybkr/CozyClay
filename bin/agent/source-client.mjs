/**
 * HTTP client for communicating with distant CozyStory / Studio 3D FastAPI backend.
 * Provides timeout protection, bounded stream reading, retry with backoff/jitter,
 * and rate-limit handling.
 */

export const JSON_REQUEST_TIMEOUT_MS = 15_000;
export const RESOURCE_REQUEST_TIMEOUT_MS = 60_000;
export const MAX_SECTION_PAGE_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;     // 8 MiB

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 410, 422]);

export class SourceClientError extends Error {
	constructor(message, { status = 502, code = "UPSTREAM_ERROR", retryable = false, retryAfterSeconds = null } = {}) {
		super(message);
		this.name = "SourceClientError";
		this.status = status;
		this.code = code;
		this.retryable = retryable;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

/**
 * Reads a response stream incrementally while ensuring it does not exceed maxBytes.
 */
async function readBoundedJson(response, maxBytes) {
	if (!response.body) {
		const text = await response.text();
		if (text.length > maxBytes) {
			throw new SourceClientError(`Response body exceeded maximum limit of ${maxBytes} bytes`, {
				status: 413,
				code: "PAYLOAD_TOO_LARGE",
			});
		}
		return JSON.parse(text);
	}

	const reader = response.body.getReader();
	let receivedBytes = 0;
	const chunks = [];

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			receivedBytes += value.byteLength;
			if (receivedBytes > maxBytes) {
				await reader.cancel();
				throw new SourceClientError(`Response body exceeded maximum limit of ${maxBytes} bytes`, {
					status: 413,
					code: "PAYLOAD_TOO_LARGE",
				});
			}
			chunks.push(value);
		}
	} catch (err) {
		if (err instanceof SourceClientError) throw err;
		throw new SourceClientError(`Failed reading upstream stream: ${err.message}`, {
			status: 502,
			code: "STREAM_READ_ERROR",
		});
	}

	const total = new Uint8Array(receivedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		total.set(chunk, offset);
		offset += chunk.byteLength;
	}

	const text = new TextDecoder("utf-8").decode(total);
	try {
		return JSON.parse(text);
	} catch (parseErr) {
		throw new SourceClientError(`Upstream response is not valid JSON: ${parseErr.message}`, {
			status: 502,
			code: "INVALID_JSON",
		});
	}
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSourceClient({
	fetchImpl = globalThis.fetch,
	clock = Date.now,
} = {}) {
	async function requestWithRetry(url, options = {}, { maxBytes = MAX_SECTION_PAGE_BYTES, isResource = false } = {}) {
		const maxRetries = 2;
		const backoffs = [500, 1500];
		const timeoutMs = isResource ? RESOURCE_REQUEST_TIMEOUT_MS : JSON_REQUEST_TIMEOUT_MS;

		for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);

			let linkedSignal = controller.signal;
			if (options.signal) {
				const parentSignal = options.signal;
				if (parentSignal.aborted) {
					clearTimeout(timer);
					throw new SourceClientError("Request aborted by caller", { status: 499, code: "ABORTED" });
				}
				parentSignal.addEventListener("abort", () => controller.abort(parentSignal.reason), { once: true });
			}

			try {
				const reqOptions = {
					...options,
					signal: linkedSignal,
				};

				const res = await fetchImpl(url, reqOptions);
				clearTimeout(timer);

				if (res.ok) {
					if (isResource) {
						return res;
					}
					return await readBoundedJson(res, maxBytes);
				}

				// Status is not OK
				const status = res.status;
				if (status === 429) {
					const retryAfterHeader = res.headers.get("retry-after");
					const retrySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;
					if (attempt < maxRetries && Number.isFinite(retrySec) && retrySec <= 30) {
						await delay(retrySec * 1000);
						continue;
					}
					throw new SourceClientError(`Upstream rate limit exceeded (429)`, {
						status: 429,
						code: "RATE_LIMITED",
						retryAfterSeconds: Number.isFinite(retrySec) ? retrySec : 30,
					});
				}

				if (NON_RETRYABLE_STATUSES.has(status)) {
					let errorDetail = `Upstream error ${status}`;
					try {
						const errJson = await res.json();
						if (errJson?.detail) errorDetail = typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail);
					} catch {
						// ignore parse error on error body
					}
					throw new SourceClientError(errorDetail, {
						status,
						code: status === 401 || status === 403 ? "AUTH_FAILED" : status === 404 ? "NOT_FOUND" : "CLIENT_ERROR",
						retryable: false,
					});
				}

				if ((status === 503 || status === 502 || status === 504) && attempt < maxRetries) {
					const jitter = Math.floor(Math.random() * 200);
					await delay(backoffs[attempt] + jitter);
					continue;
				}

				throw new SourceClientError(`Upstream answered ${status}`, {
					status,
					code: "SERVER_ERROR",
					retryable: attempt < maxRetries,
				});
			} catch (err) {
				clearTimeout(timer);
				if (err instanceof SourceClientError) throw err;

				if (attempt < maxRetries && !options.signal?.aborted) {
					const jitter = Math.floor(Math.random() * 200);
					await delay(backoffs[attempt] + jitter);
					continue;
				}

				throw new SourceClientError(`Network error communicating with upstream: ${err.message}`, {
					status: 502,
					code: "NETWORK_ERROR",
					retryable: false,
				});
			}
		}
	}

	function authHeaders(apiKey) {
		const headers = {
			Accept: "application/json",
		};
		if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`;
		}
		return headers;
	}

	async function testConnection(baseUrl, apiKey, { signal } = {}) {
		const start = clock();
		const url = `${baseUrl}/api/studio/v1/capabilities`;
		const data = await requestWithRetry(url, {
			method: "GET",
			headers: authHeaders(apiKey),
			signal,
		}, { maxBytes: 64 * 1024 });

		const latencyMs = clock() - start;
		return {
			ok: true,
			latencyMs,
			schemaVersion: data.schemaVersion,
			supportedSections: data.supportedSections,
		};
	}

	async function fetchManifest(baseUrl, apiKey, projectId, { signal } = {}) {
		const url = `${baseUrl}/api/studio/v1/projects/${encodeURIComponent(projectId)}/manifest`;
		return await requestWithRetry(url, {
			method: "GET",
			headers: authHeaders(apiKey),
			signal,
		}, { maxBytes: 512 * 1024 });
	}

	async function fetchRevisionManifest(baseUrl, apiKey, projectId, revision, { signal } = {}) {
		const url = `${baseUrl}/api/studio/v1/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revision)}/manifest`;
		return await requestWithRetry(url, {
			method: "GET",
			headers: authHeaders(apiKey),
			signal,
		}, { maxBytes: 512 * 1024 });
	}

	async function fetchSectionPage(baseUrl, apiKey, projectId, revision, section, { cursor = null, limit = 50, signal } = {}) {
		const query = new URLSearchParams();
		if (cursor) query.set("cursor", cursor);
		if (limit) query.set("limit", String(limit));
		const qs = query.toString();
		const url = `${baseUrl}/api/studio/v1/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revision)}/sections/${encodeURIComponent(section)}${qs ? `?${qs}` : ""}`;
		return await requestWithRetry(url, {
			method: "GET",
			headers: authHeaders(apiKey),
			signal,
		}, { maxBytes: MAX_SECTION_PAGE_BYTES });
	}

	async function fetchSnapshot(baseUrl, apiKey, projectId, revision, { signal } = {}) {
		const url = `${baseUrl}/api/studio/v1/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revision)}/snapshot`;
		return await requestWithRetry(url, {
			method: "GET",
			headers: authHeaders(apiKey),
			signal,
		}, { maxBytes: MAX_SNAPSHOT_BYTES });
	}

	async function fetchResource(baseUrl, apiKey, projectId, revision, resourceId, { signal } = {}) {
		const url = `${baseUrl}/api/studio/v1/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revision)}/resources/${encodeURIComponent(resourceId)}`;
		const headers = {};
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		return await requestWithRetry(url, {
			method: "GET",
			headers,
			signal,
		}, { isResource: true });
	}

	return {
		testConnection,
		fetchManifest,
		fetchRevisionManifest,
		fetchSectionPage,
		fetchSnapshot,
		fetchResource,
	};
}
