/**
 * Tests : TimeMap — carte temporelle globale↔locale, trim, ripple.
 * Spec : 06-correctifs C7, 05 §§1 et 8.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createTimeMap,
	buildTimeMapFromSnapshot,
	localToGlobalBatch,
} from "../src/production/time-map.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeScenes(durations) {
	let cursor = 0;
	return durations.map((dur, i) => {
		const span = { sceneId: `SCENE_${i + 1}`, startGlobal: cursor, endGlobal: cursor + dur };
		cursor += dur;
		return span;
	});
}

// ---------------------------------------------------------------------------
// 1. Résolution globale → locale
// ---------------------------------------------------------------------------
test("TimeMap: resolve maps global frame to correct scene and local frame", () => {
	// 3 scènes : 96, 192, 96 frames
	const tm = createTimeMap(makeScenes([96, 192, 96]));

	// Frame 0 → SCENE_1, locale 0
	const r0 = tm.resolve(0);
	assert.equal(r0.sceneId, "SCENE_1");
	assert.equal(r0.localFrame, 0);

	// Frame 95 → SCENE_1, locale 95
	const r95 = tm.resolve(95);
	assert.equal(r95.sceneId, "SCENE_1");
	assert.equal(r95.localFrame, 95);

	// Frame 96 → SCENE_2, locale 0
	const r96 = tm.resolve(96);
	assert.equal(r96.sceneId, "SCENE_2");
	assert.equal(r96.localFrame, 0);

	// Frame 287 → SCENE_2, locale 191
	const r287 = tm.resolve(287);
	assert.equal(r287.sceneId, "SCENE_2");
	assert.equal(r287.localFrame, 191);

	// Frame 288 → SCENE_3, locale 0
	const r288 = tm.resolve(288);
	assert.equal(r288.sceneId, "SCENE_3");
	assert.equal(r288.localFrame, 0);

	// Hors plage → null
	assert.equal(tm.resolve(-1), null);
	assert.equal(tm.resolve(384), null); // 96+192+96=384
});

// ---------------------------------------------------------------------------
// 2. Résolution locale → globale
// ---------------------------------------------------------------------------
test("TimeMap: toGlobal converts local frame to global frame correctly", () => {
	const tm = createTimeMap(makeScenes([96, 192, 96]));

	assert.equal(tm.toGlobal("SCENE_1", 0), 0);
	assert.equal(tm.toGlobal("SCENE_1", 95), 95);
	assert.equal(tm.toGlobal("SCENE_2", 0), 96);
	assert.equal(tm.toGlobal("SCENE_2", 191), 287);
	assert.equal(tm.toGlobal("SCENE_3", 0), 288);

	// Scène inconnue → null
	assert.equal(tm.toGlobal("SCENE_X", 0), null);
	// Hors borne de scène → null
	assert.equal(tm.toGlobal("SCENE_1", 96), null);
});

// ---------------------------------------------------------------------------
// 3. totalFrames
// ---------------------------------------------------------------------------
test("TimeMap: totalFrames is sum of all scene durations", () => {
	const tm = createTimeMap(makeScenes([96, 192, 96]));
	assert.equal(tm.totalFrames, 384);
});

// ---------------------------------------------------------------------------
// 4. Trim mono-clip — idempotence (changed:false)
// ---------------------------------------------------------------------------
test("TimeMap: trimClip returns changed:false when bounds are identical", () => {
	const tm = createTimeMap(makeScenes([288]));
	const clip = { startFrame: 0, endFrameExclusive: 96, dstStart: 0, dstEnd: 96 };
	const result = tm.trimClip(clip, 0, 96);
	assert.equal(result.changed, false);
});

// ---------------------------------------------------------------------------
// 5. Trim mono-clip — changed:true
// ---------------------------------------------------------------------------
test("TimeMap: trimClip returns changed:true with correct rate when bounds change", () => {
	const tm = createTimeMap(makeScenes([288]));
	// Clip couvre dst [0, 96), on trim la source à [10, 90) → durée 80 frames src pour 96 frames dst
	const clip = { startFrame: 0, endFrameExclusive: 96, dstStart: 0, dstEnd: 96 };
	const result = tm.trimClip(clip, 10, 90);
	assert.equal(result.changed, true);
	assert.equal(result.segments.length, 1);
	const seg = result.segments[0];
	assert.equal(seg.srcStart, 10);
	assert.equal(seg.srcEnd, 90);
	assert.equal(seg.dstStart, 0);
	assert.equal(seg.dstEnd, 96);
	// rate = 96 / 80 = 1.2
	assert.ok(Math.abs(seg.rate - 1.2) < 0.001, `rate should be ~1.2, got ${seg.rate}`);
});

// ---------------------------------------------------------------------------
// 6. Ripple global — changed:false si deltaFrames === 0
// ---------------------------------------------------------------------------
test("TimeMap: ripple returns changed:false when deltaFrames is zero", () => {
	const tm = createTimeMap(makeScenes([96, 192]));
	const tracks = [
		{ kind: "motion-clip", sceneId: "SCENE_1", id: "clip-A", startFrame: 0, endFrameExclusive: 96, frames: [] },
	];
	const result = tm.ripple(0, 0, tracks);
	assert.equal(result.changed, false);
});

// ---------------------------------------------------------------------------
// 7. Ripple global — remappe les frames >= pivot
// ---------------------------------------------------------------------------
test("TimeMap: ripple remaps frames at or after pivot, leaves earlier frames intact", () => {
	const tm = createTimeMap(makeScenes([96, 192]));
	// Deux pistes : une motion-clip dans SCENE_1, une camera-key dans SCENE_2
	const tracks = [
		{
			kind: "motion-clip",
			sceneId: "SCENE_1",
			id: "clip-A",
			startFrame: 0,
			endFrameExclusive: 96,
			frames: [
				{ localFrame: 0, globalFrame: 0 },
				{ localFrame: 48, globalFrame: 48 },
				{ localFrame: 95, globalFrame: 95 },
			],
		},
		{
			kind: "camera-key",
			sceneId: "SCENE_2",
			id: "cam-key-1",
			startFrame: 0,
			endFrameExclusive: 192,
			frames: [
				{ localFrame: 0, globalFrame: 96 },
				{ localFrame: 100, globalFrame: 196 },
			],
		},
	];

	// Ripple à partir de frame globale 96 (= début SCENE_2) avec +24 frames
	const result = tm.ripple(96, 24, tracks);
	assert.equal(result.changed, true);
	assert.equal(result.unsupported.length, 0);

	// SCENE_1 : frame 95 < pivot 96 → inchangée
	const clipRemapped = result.remapped[0];
	assert.equal(clipRemapped.frames[2].globalFrame, 95); // inchangée

	// SCENE_2 : frame 96 >= pivot → décalée de +24 → 120
	const camRemapped = result.remapped[1];
	assert.equal(camRemapped.frames[0].globalFrame, 120);
	assert.equal(camRemapped.frames[1].globalFrame, 220);
});

// ---------------------------------------------------------------------------
// 8. Ripple — refuse si une piste a un kind inconnu
// ---------------------------------------------------------------------------
test("TimeMap: ripple returns changed:false and lists unsupported kinds", () => {
	const tm = createTimeMap(makeScenes([288]));
	const tracks = [
		{ kind: "unknown-track-type", id: "mystery", sceneId: "SCENE_1", frames: [] },
	];
	const result = tm.ripple(0, 10, tracks);
	assert.equal(result.changed, false);
	assert.ok(result.unsupported.length > 0, "should list unsupported track");
	assert.ok(result.unsupported[0].includes("unknown-track-type"));
});

// ---------------------------------------------------------------------------
// 9. buildTimeMapFromSnapshot
// ---------------------------------------------------------------------------
test("TimeMap: buildTimeMapFromSnapshot builds correct spans from snapshot scenes", () => {
	const snapshot = {
		scenes: [
			{ id: "S1", durationSeconds: 4 }, // 4 × 24 = 96 frames
			{ id: "S2", durationSeconds: 8 }, // 8 × 24 = 192 frames
		],
	};
	const tm = buildTimeMapFromSnapshot(snapshot);
	assert.equal(tm.totalFrames, 288);
	assert.equal(tm.resolve(0)?.sceneId, "S1");
	assert.equal(tm.resolve(96)?.sceneId, "S2");
	assert.equal(tm.resolve(96)?.localFrame, 0);
});

// ---------------------------------------------------------------------------
// 10. localToGlobalBatch
// ---------------------------------------------------------------------------
test("TimeMap: localToGlobalBatch converts batch of local frames correctly", () => {
	const tm = createTimeMap(makeScenes([96, 192]));
	const results = localToGlobalBatch(tm, "SCENE_2", [0, 50, 191]);
	assert.deepEqual(results, [96, 146, 287]);
});

// ---------------------------------------------------------------------------
// 11. Validation : gap entre scènes → erreur
// ---------------------------------------------------------------------------
test("TimeMap: throws RangeError on gap between scenes", () => {
	assert.throws(() => {
		createTimeMap([
			{ sceneId: "A", startGlobal: 0, endGlobal: 96 },
			{ sceneId: "B", startGlobal: 100, endGlobal: 200 }, // gap!
		]);
	}, RangeError);
});

// ---------------------------------------------------------------------------
// 12. Mouvement à travers un cut caméra (spec §1)
// Vérifie que la continuité temporelle entre deux scènes est correcte
// ---------------------------------------------------------------------------
test("TimeMap: action crossing camera cut has continuous global frames", () => {
	// Action [72, 144) traverse le cut à frame 96 (fin SCENE_1)
	const tm = createTimeMap(makeScenes([96, 96]));

	// Frame 72 → SCENE_1, locale 72
	const f72 = tm.resolve(72);
	assert.equal(f72.sceneId, "SCENE_1");
	assert.equal(f72.localFrame, 72);

	// Frame 96 → SCENE_2, locale 0 (pas de reset)
	const f96 = tm.resolve(96);
	assert.equal(f96.sceneId, "SCENE_2");
	assert.equal(f96.localFrame, 0);

	// Frame 143 → SCENE_2, locale 47
	const f143 = tm.resolve(143);
	assert.equal(f143.sceneId, "SCENE_2");
	assert.equal(f143.localFrame, 47);
});
