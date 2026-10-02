/**
 * Browser-side client for interacting with the local /agent/source sidecar endpoints.
 * Handles progressive loading of sections with cursor pagination, validation,
 * cancellation tickets, and detailed error mapping.
 */
import {
	SOURCE_SCHEMA_VERSIONS,
	SOURCE_SECTIONS,
	SOURCE_LIMITS,
	validateSectionPage,
	validateSnapshot,
	computeCanonicalHash,
	computeSectionHash,
} from "./source-contract.js";

export class SourceApiError extends Error {
	constructor(message, { status = 502, code = "NETWORK_ERROR", retryable = false, retryAfterSeconds = null } = {}) {
		super(message);
		this.name = "SourceApiError";
		this.status = status;
		this.code = code;
		this.retryable = retryable;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

async function requestJson(url, options = {}) {
	let res;
	try {
		res = await fetch(url, {
			headers: { Accept: "application/json", ...(options.headers || {}) },
			...options,
		});
	} catch (err) {
		if (err.name === "AbortError" || options.signal?.aborted) {
			throw new SourceApiError("Request cancelled", { status: 499, code: "CANCELLED" });
		}
		throw new SourceApiError(`Cannot connect to studio sidecar: ${err.message}`, {
			status: 502,
			code: "SIDECAR_UNAVAILABLE",
		});
	}

	let data;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const message = data?.error || `Request failed with status ${res.status}`;
		throw new SourceApiError(message, {
			status: res.status,
			code: data?.code || (res.status === 401 || res.status === 403 ? "AUTH_FAILED" : "HTTP_ERROR"),
			retryable: res.status >= 500,
			retryAfterSeconds: data?.retryAfterSeconds || null,
		});
	}

	return data;
}

export async function listConnections({ signal } = {}) {
	const data = await requestJson("/agent/source/connections", { signal });
	return data.connections || [];
}

export async function createConnection({ name, baseUrl, credential }, { signal } = {}) {
	return await requestJson("/agent/source/connections", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, baseUrl, credential }),
		signal,
	});
}

export async function updateConnection(id, patch, { signal } = {}) {
	return await requestJson(`/agent/source/connections/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
		signal,
	});
}

export async function removeConnection(id, { signal } = {}) {
	return await requestJson(`/agent/source/connections/${encodeURIComponent(id)}`, {
		method: "DELETE",
		signal,
	});
}

export async function testConnection(id, { signal } = {}) {
	return await requestJson(`/agent/source/connections/${encodeURIComponent(id)}/test`, {
		method: "POST",
		signal,
	});
}

export async function fetchManifest(connectionId, projectId, revision = null, { signal } = {}) {
	const base = `/agent/source/connections/${encodeURIComponent(connectionId)}/projects/${encodeURIComponent(projectId)}`;
	const url = revision
		? `${base}/revisions/${encodeURIComponent(revision)}/manifest`
		: `${base}/manifest`;
	return await requestJson(url, { signal });
}

export async function fetchSectionPage(connectionId, projectId, revision, section, { cursor = null, limit = 50, signal } = {}) {
	const query = new URLSearchParams();
	if (cursor) query.set("cursor", cursor);
	if (limit) query.set("limit", String(limit));
	const qs = query.toString();
	const url = `/agent/source/connections/${encodeURIComponent(connectionId)}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revision)}/sections/${encodeURIComponent(section)}${qs ? `?${qs}` : ""}`;
	return await requestJson(url, { signal });
}

export async function fetchDirectSnapshot(connectionId, projectId, revision, { signal } = {}) {
	const url = `/agent/source/connections/${encodeURIComponent(connectionId)}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revision)}/snapshot`;
	return await requestJson(url, { signal });
}

export function getResourceUrl(connectionId, projectId, revision, resourceId) {
	return `/agent/source/connections/${encodeURIComponent(connectionId)}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revision)}/resources/${encodeURIComponent(resourceId)}`;
}

/**
 * Progressively loads all sections of a story project, validating against manifest hashes
 * and assembling an immutable StudioSnapshot without creating 3D scene mutations.
 */
export async function fetchFullSnapshotProgressive(connectionId, projectId, {
	revision = null,
	onProgress = () => {},
	signal = null,
} = {}) {
	// 1. Fetch manifest
	onProgress({ phase: "manifest", message: "Lecture du manifeste distant..." });
	const manifest = await fetchManifest(connectionId, projectId, revision, { signal });

	if (!SOURCE_SCHEMA_VERSIONS.includes(manifest.schemaVersion)) {
		throw new SourceApiError(`Version de schéma non supportée: ${manifest.schemaVersion}`, {
			code: "SCHEMA_MISMATCH",
		});
	}

	if (manifest.projectId !== projectId || (revision && manifest.revision !== revision)) throw new SourceApiError("Manifest identity mismatch", { code: "REVISION_MISMATCH" });
	const pinnedRevision = manifest.revision;
	const sectionsMeta = {};
	if (Array.isArray(manifest.sections)) {
		for (const sec of manifest.sections) {
			if (sec && sec.name) {
				sectionsMeta[sec.name] = sec;
			}
		}
	} else if (manifest.sections && typeof manifest.sections === "object") {
		Object.assign(sectionsMeta, manifest.sections);
	}

	const projectSpec = manifest.project || {
		aspect: manifest.aspect || "9:16",
		durationSeconds: manifest.durationSeconds || 12.0,
		fps: manifest.fps || 24,
	};

	// Ordered sections per specification
	const sectionsOrder = ["characters", "sets", "scenes", "shots", "actions", "narration"];
	const assembled = {
		schemaVersion: manifest.schemaVersion,
		projectId: manifest.projectId,
		revision: pinnedRevision,
		title: manifest.title || `Projet ${manifest.projectId}`,
		sourceMode: manifest.sourceMode || "structured",
		project: {
			fps: projectSpec.fps || 24,
			aspect: projectSpec.aspect || "9:16",
			durationSeconds: projectSpec.durationSeconds || 12.0,
		},
		characters: [],
		sets: [],
		scenes: [],
		shots: [],
		actions: [],
		narration: [],
		resources: manifest.resources || [],
	};

	let totalExpectedItems = 0;
	for (const secName of sectionsOrder) {
		totalExpectedItems += sectionsMeta[secName]?.count || 0;
	}

	let accumulatedItems = 0;

	// 2. Fetch each section progressively
	for (let i = 0; i < sectionsOrder.length; i += 1) {
		const secName = sectionsOrder[i];
		const secMeta = sectionsMeta[secName];
		const expectedCount = secMeta?.count || 0;

		const collectedForSec = await fetchValidatedSection(connectionId, projectId, manifest, secName, {
   signal, onProgress: count => onProgress({ phase: "section", section: secName, loadedCount: accumulatedItems + count, totalCount: totalExpectedItems })
  });

		accumulatedItems += collectedForSec.length;
		assembled[secName] = collectedForSec;
	}

	// 3. Validate complete snapshot
	onProgress({ phase: "validation", message: "Validation du snapshot..." });
	if (new TextEncoder().encode(JSON.stringify(assembled)).length > SOURCE_LIMITS.maxSnapshotBytes) throw new SourceApiError("Snapshot exceeds local limits", { code: "PAYLOAD_TOO_LARGE" });
	const validation = validateSnapshot(assembled);

	if (!validation.valid) {
		const errorDetails = (validation.errors || []).map((e) => `${e.path}: ${e.message}`).join(", ");
		throw new SourceApiError(`Validation du snapshot échouée: ${errorDetails}`, {
			code: "INVALID_SNAPSHOT",
			errors: validation.errors,
		});
	}

	return {
		snapshot: assembled,
		manifest,
		valid: true,
		errors: [],
		warnings: (validation.errors || []).filter((e) => e.severity === "warning"),
	};
}

/** Fetch a complete pinned section; reject mixed revisions, corruption and cursor loops. */
export async function fetchValidatedSection(connectionId, projectId, manifest, section, { signal, onProgress = () => {} } = {}) {
 if (!SOURCE_SECTIONS.includes(section)) throw new SourceApiError("Unknown section " + section, { code: "INVALID_SECTION" });
 const meta = Array.isArray(manifest.sections) ? manifest.sections.find(s => s.name === section) : manifest.sections?.[section];
 const items = [], cursors = new Set();
 let cursor = null;
 do {
  if (signal?.aborted) throw new SourceApiError("Request cancelled", { code: "CANCELLED" });
  const page = await fetchSectionPage(connectionId, projectId, manifest.revision, section, { cursor, signal });
  const validation = validateSectionPage(page, section);
  if (!validation.valid) throw new SourceApiError("Invalid section page", { code: "INVALID_PAGE" });
  if (manifest.schemaVersion && page.schemaVersion !== manifest.schemaVersion) throw new SourceApiError("Section schema mismatch", { code: "SCHEMA_MISMATCH" });
  if (page.projectId !== projectId || page.revision !== manifest.revision) throw new SourceApiError("Section revision mismatch", { code: "REVISION_MISMATCH" });
  if (page.manifestHash && manifest.manifestHash && page.manifestHash !== manifest.manifestHash) throw new SourceApiError("Manifest hash mismatch", { code: "HASH_MISMATCH" });
  if (meta?.count !== undefined && page.total !== meta.count) throw new SourceApiError("Section total mismatch", { code: "COUNT_MISMATCH" });
  items.push(...page.items);
  if (new TextEncoder().encode(JSON.stringify(items)).length > SOURCE_LIMITS.maxSnapshotBytes || items.length > 10000) throw new SourceApiError("Section exceeds local limits", { code: "PAYLOAD_TOO_LARGE" });
  onProgress(items.length);
  cursor = page.nextCursor;
  if (cursor && (cursors.has(cursor) || !page.items.length)) throw new SourceApiError("Invalid pagination cursor", { code: "CURSOR_LOOP" });
  if (cursor) cursors.add(cursor);
 } while (cursor);
 if (meta?.count !== undefined && items.length !== meta.count) throw new SourceApiError("Incomplete section", { code: "COUNT_MISMATCH" });
 if (meta?.hash && await computeSectionHash(section, items) !== meta.hash) throw new SourceApiError("Section hash mismatch", { code: "HASH_MISMATCH" });
 if (meta?.ids && (new Set(items.map(i => i.id)).size !== items.length || items.some(i => !meta.ids.includes(i.id)))) throw new SourceApiError("Section IDs mismatch", { code: "INVALID_PAGE" });
 return items;
}
