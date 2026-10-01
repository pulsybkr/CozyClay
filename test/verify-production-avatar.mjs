import assert from "node:assert/strict";
import { test } from "node:test";
import { produceAvatar, BUILTIN_AVATAR_MODELS } from "../src/production/avatar-producer.js";

test("Avatar Producer: assigns builtin models deterministically", async () => {
	const unitA = {
		id: "avatar_CHAR_A",
		inputHash: "hash-avatar-A",
		payload: { characterId: "CHAR_A", strategy: "builtin" },
	};
	const unitB = {
		id: "avatar_CHAR_B",
		inputHash: "hash-avatar-B",
		payload: { characterId: "CHAR_B", strategy: "builtin" },
	};

	const resA1 = await produceAvatar(unitA);
	const resA2 = await produceAvatar(unitA);
	const resB = await produceAvatar(unitB);

	assert.equal(resA1.characterId, "CHAR_A");
	assert.equal(resA1.source, "builtin");
	assert.ok(resA1.vrmUrl);
	assert.equal(resA1.artifactRef.kind, "vrm");
	assert.equal(resA1.artifactRef.hash, "hash-avatar-A");

	// Determinism
	assert.equal(resA1.vrmUrl, resA2.vrmUrl);
});

test("Avatar Producer: respects abort signal", async () => {
	const controller = new AbortController();
	controller.abort();

	const unit = {
		id: "avatar_CHAR_01",
		inputHash: "hash-1",
		payload: { characterId: "CHAR_01" },
	};

	await assert.rejects(
		async () => await produceAvatar(unit, { signal: controller.signal }),
		/aborted/i,
	);
});
