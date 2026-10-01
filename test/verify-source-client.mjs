import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSourceClient, SourceClientError } from "../bin/agent/source-client.mjs";

describe("source-client", () => {
	it("attaches Authorization header when apiKey is supplied", async () => {
		let capturedHeaders = null;
		const mockFetch = async (url, options) => {
			capturedHeaders = options.headers;
			return new Response(JSON.stringify({ schemaVersion: "cozy-story-v1", supportedSections: ["characters"], maxLimit: 100 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const client = createSourceClient({ fetchImpl: mockFetch });
		const result = await client.testConnection("http://api.local", "secret-token-123");
		assert.equal(result.ok, true);
		assert.equal(capturedHeaders.Authorization, "Bearer secret-token-123");
	});

	it("does not attach Authorization header when apiKey is null", async () => {
		let capturedHeaders = null;
		const mockFetch = async (url, options) => {
			capturedHeaders = options.headers;
			return new Response(JSON.stringify({ schemaVersion: "cozy-story-v1", supportedSections: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const client = createSourceClient({ fetchImpl: mockFetch });
		await client.testConnection("http://api.local", null);
		assert.equal(capturedHeaders.Authorization, undefined);
	});

	it("throws SourceClientError on 401 without retry", async () => {
		let callCount = 0;
		const mockFetch = async () => {
			callCount += 1;
			return new Response(JSON.stringify({ detail: "Invalid token" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		};

		const client = createSourceClient({ fetchImpl: mockFetch });
		await assert.rejects(
			async () => client.fetchManifest("http://api.local", "bad-key", "proj-1"),
			(err) => {
				assert.equal(err instanceof SourceClientError, true);
				assert.equal(err.status, 401);
				assert.equal(err.code, "AUTH_FAILED");
				assert.equal(err.retryable, false);
				return true;
			}
		);
		assert.equal(callCount, 1); // exactly 1 call, no retries
	});

	it("retries on 503 and succeeds on second attempt", async () => {
		let callCount = 0;
		const mockFetch = async () => {
			callCount += 1;
			if (callCount === 1) {
				return new Response(JSON.stringify({ detail: "Busy" }), { status: 503 });
			}
			return new Response(JSON.stringify({ projectId: "proj-1", revision: "r01", manifestHash: "sha256:abc" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const client = createSourceClient({ fetchImpl: mockFetch });
		const manifest = await client.fetchManifest("http://api.local", "key", "proj-1");
		assert.equal(callCount, 2);
		assert.equal(manifest.projectId, "proj-1");
	});

	it("enforces stream reading limit and throws 413 if response exceeds maxBytes", async () => {
		const largeJson = JSON.stringify({ items: new Array(50000).fill("long-string-data-overflowing-buffer-threshold") });
		const mockFetch = async () => {
			return new Response(largeJson, {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};

		const client = createSourceClient({ fetchImpl: mockFetch });
		// Section page max is 2 MiB, largeJson exceeds it
		await assert.rejects(
			async () => client.fetchSectionPage("http://api.local", "key", "proj", "r01", "shots"),
			(err) => {
				assert.equal(err instanceof SourceClientError, true);
				assert.equal(err.status, 413);
				assert.equal(err.code, "PAYLOAD_TOO_LARGE");
				return true;
			}
		);
	});
});
