/**
 * Management of upstream workflow story connections.
 * Public configurations (id, name, baseUrl) are stored securely in CozyClay config.
 * Secret API keys are stored write-only via provider-keys.mjs under workflow-source:<connectionId>.
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeSecureJson } from "./secure-file.mjs";
import * as defaultKeys from "./provider-keys.mjs";

export function normalizeBaseUrl(url) {
	if (typeof url !== "string") throw new TypeError("baseUrl must be a string");
	const trimmed = url.trim();
	if (!trimmed) throw new Error("baseUrl cannot be empty");
	// Validate URL syntax
	const parsed = new URL(trimmed);
	if (!["http:", "https:"].includes(parsed.protocol)) {
		throw new Error("baseUrl must start with http:// or https://");
	}
	return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, ""));
}

export function createConnectionStore({
	env = process.env,
	configDir = null,
	keys = defaultKeys,
} = {}) {
	const keyStore = keys || defaultKeys;
	const resolvedConfigDir = () => {
		if (configDir) return configDir;
		return env.COZYCLAY_SOURCE_CONFIG_DIR
			|| env.COZYCLAY_CONFIG_DIR
			|| join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cozyclay");
	};

	const filePath = () => join(resolvedConfigDir(), "workflow-sources.json");

	function readStoredConnections() {
		const path = filePath();
		let raw;
		try {
			raw = readFileSync(path, "utf8");
		} catch (error) {
			if (error?.code === "ENOENT") return [];
			throw error;
		}
		try {
			const data = JSON.parse(raw);
			return Array.isArray(data) ? data : [];
		} catch {
			return [];
		}
	}

	function writeStoredConnections(items) {
		writeSecureJson(filePath(), items);
	}

	function getEnvConnection() {
		const rawKey = (
			env.COZYCLAY_WORKFLOW_API_KEY
			|| env.STUDIO_API_KEY
			|| env.WORKFLOW_API_KEY
		)?.trim() || null;

		const rawUrl = (
			env.COZYCLAY_WORKFLOW_API_URL
			|| env.STUDIO_API_URL
			|| env.WORKFLOW_API_URL
			|| (rawKey ? "http://127.0.0.1:8000" : null)
		)?.trim();

		if (!rawUrl) return null;
		let normUrl;
		try {
			normUrl = normalizeBaseUrl(rawUrl);
		} catch {
			return null;
		}
		return {
			id: "env-default",
			name: "Environnement",
			baseUrl: normUrl,
			credentialConfigured: Boolean(rawKey),
			isEnv: true,
		};
	}

	function listConnections() {
		const savedKeys = keyStore?.readKeys?.() ?? {};
		const stored = readStoredConnections();
		const result = stored.map((item) => ({
			id: item.id,
			name: item.name,
			baseUrl: item.baseUrl,
			credentialConfigured: Boolean(savedKeys[`workflow-source:${item.id}`]),
		}));

		const envConn = getEnvConnection();
		if (envConn) {
			result.unshift(envConn);
		}
		return result;
	}

	function getConnection(id) {
		const all = listConnections();
		return all.find((c) => c.id === id) || null;
	}

	function resolveConnection(id) {
		if (id === "env-default") {
			const envConn = getEnvConnection();
			if (!envConn) return null;
			const apiKey = (
				env.COZYCLAY_WORKFLOW_API_KEY
				|| env.STUDIO_API_KEY
				|| env.WORKFLOW_API_KEY
			)?.trim() || null;
			return {
				connection: envConn,
				apiKey,
			};
		}

		const stored = readStoredConnections().find((c) => c.id === id);
		if (!stored) return null;
		const savedKeys = keyStore?.readKeys?.() ?? {};
		const apiKey = savedKeys[`workflow-source:${id}`] || null;
		return {
			connection: {
				id: stored.id,
				name: stored.name,
				baseUrl: stored.baseUrl,
				credentialConfigured: Boolean(apiKey),
			},
			apiKey,
		};
	}

	function createConnection({ name, baseUrl, credential }) {
		if (!name || typeof name !== "string" || !name.trim()) {
			throw new Error("Connection name is required");
		}
		const normUrl = normalizeBaseUrl(baseUrl);
		const id = `conn_${randomBytes(4).toString("hex")}`;
		const stored = readStoredConnections();

		const entry = {
			id,
			name: name.trim(),
			baseUrl: normUrl,
		};
		stored.push(entry);
		writeStoredConnections(stored);

		if (typeof credential === "string" && credential.trim()) {
			keyStore?.setKey?.(`workflow-source:${id}`, credential.trim());
		}

		return {
			id,
			name: entry.name,
			baseUrl: entry.baseUrl,
			credentialConfigured: Boolean(credential?.trim()),
		};
	}

	function updateConnection(id, { name, baseUrl, credential }) {
		if (id === "env-default") {
			throw new Error("Cannot modify environment-provided connection");
		}
		const stored = readStoredConnections();
		const idx = stored.findIndex((c) => c.id === id);
		if (idx === -1) {
			throw new Error(`Connection ${id} not found`);
		}

		if (name !== undefined) {
			if (!name || typeof name !== "string" || !name.trim()) {
				throw new Error("Connection name cannot be empty");
			}
			stored[idx].name = name.trim();
		}

		if (baseUrl !== undefined) {
			stored[idx].baseUrl = normalizeBaseUrl(baseUrl);
		}

		writeStoredConnections(stored);

		if (credential !== undefined) {
			if (typeof credential === "string" && credential.trim()) {
				keyStore?.setKey?.(`workflow-source:${id}`, credential.trim());
			} else {
				keyStore?.removeKey?.(`workflow-source:${id}`);
			}
		}

		const savedKeys = keyStore?.readKeys?.() ?? {};
		return {
			id: stored[idx].id,
			name: stored[idx].name,
			baseUrl: stored[idx].baseUrl,
			credentialConfigured: Boolean(savedKeys[`workflow-source:${id}`]),
		};
	}

	function removeConnection(id) {
		if (id === "env-default") {
			throw new Error("Cannot remove environment-provided connection");
		}
		const stored = readStoredConnections();
		const next = stored.filter((c) => c.id !== id);
		if (next.length === stored.length) {
			return false;
		}
		writeStoredConnections(next);
		keyStore?.removeKey?.(`workflow-source:${id}`);
		return true;
	}

	return {
		listConnections,
		getConnection,
		resolveConnection,
		createConnection,
		updateConnection,
		removeConnection,
	};
}
