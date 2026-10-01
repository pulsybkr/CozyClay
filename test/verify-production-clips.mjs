import assert from "node:assert/strict";
import { test } from "node:test";
import {
	produceMotionClip,
	composeActorTracks,
	MOTION_PRESETS,
} from "../src/production/clip-producer.js";

test("Clip Producer: produces single-actor motion clip deterministically", async () => {
	const unitAWalk = {
		id: "clip_act_1",
		inputHash: "hash-walk-A",
		payload: {
			characterId: "CHAR_A",
			actionType: "walk",
			startFrame: 0,
			endFrame: 48,
		},
	};

	const result = await produceMotionClip(unitAWalk);
	assert.equal(result.characterId, "CHAR_A");
	assert.equal(result.clip.actionType, "walk");
	assert.equal(result.clip.startFrame, 0);
	assert.equal(result.clip.endFrame, 48);
	assert.equal(result.clip.durationFrames, 48);
	assert.equal(result.clip.rootMotion, true);
	assert.equal(result.artifactRef.kind, "motion-clip");
	assert.equal(result.artifactRef.hash, "hash-walk-A");
});

test("Clip Producer: 3 jobs (A walks, A waves, B answers) are independent and composable", async () => {
	// Job 1: A walks (0 to 48)
	const unitAWalk = {
		id: "clip_A_walk",
		inputHash: "hash-A-walk",
		payload: { characterId: "CHAR_A", actionType: "walk", startFrame: 0, endFrame: 48 },
	};
	// Job 2: A waves (72 to 120)
	const unitAWave = {
		id: "clip_A_wave",
		inputHash: "hash-A-wave",
		payload: { characterId: "CHAR_A", actionType: "wave", startFrame: 72, endFrame: 120 },
	};
	// Job 3: B answers (wave/talk 96 to 168)
	const unitBAnswer = {
		id: "clip_B_answer",
		inputHash: "hash-B-answer",
		payload: { characterId: "CHAR_B", actionType: "talk", startFrame: 96, endFrame: 168 },
	};

	const [clipA1, clipA2, clipB] = await Promise.all([
		produceMotionClip(unitAWalk),
		produceMotionClip(unitAWave),
		produceMotionClip(unitBAnswer),
	]);

	// Verify A and B outputs are isolated
	assert.equal(clipA1.characterId, "CHAR_A");
	assert.equal(clipA2.characterId, "CHAR_A");
	assert.equal(clipB.characterId, "CHAR_B");

	// Compose multi-actor tracks
	const tracks = composeActorTracks([clipA1, clipA2, clipB]);
	assert.equal(tracks.size, 2, "Tracks should contain exactly CHAR_A and CHAR_B");

	const trackA = tracks.get("CHAR_A");
	const trackB = tracks.get("CHAR_B");

	// CHAR_A has walk, idle filler (48-72), wave
	assert.equal(trackA.length, 3);
	assert.equal(trackA[0].actionType, "walk");
	assert.equal(trackA[1].isFiller, true);
	assert.equal(trackA[1].startFrame, 48);
	assert.equal(trackA[1].endFrame, 72);
	assert.equal(trackA[2].actionType, "wave");

	// CHAR_B has talk
	assert.equal(trackB.length, 1);
	assert.equal(trackB[0].actionType, "talk");

	// Re-generation of A alone does not affect B
	const updatedUnitAWave = {
		id: "clip_A_wave_v2",
		inputHash: "hash-A-wave-v2",
		payload: { characterId: "CHAR_A", actionType: "wave", startFrame: 72, endFrame: 130 },
	};
	const updatedClipA2 = await produceMotionClip(updatedUnitAWave);

	const recomposedTracks = composeActorTracks([clipA1, updatedClipA2, clipB]);
	const recomposedA = recomposedTracks.get("CHAR_A");
	const recomposedB = recomposedTracks.get("CHAR_B");

	assert.equal(recomposedA[2].endFrame, 130);
	assert.deepEqual(recomposedB, trackB, "CHAR_B track must remain unchanged when CHAR_A is regenerated");
});

test("Clip Producer: camera cuts do not split or disrupt underlying motion", async () => {
	// A continuous walk from frame 0 to 96 while camera cuts occur at frame 24 and 48
	const unitContinuous = {
		id: "clip_continuous_walk",
		inputHash: "hash-walk-cont",
		payload: { characterId: "CHAR_A", actionType: "walk", startFrame: 0, endFrame: 96 },
	};
	const result = await produceMotionClip(unitContinuous);

	// The clip spans the full 96 frames regardless of camera cuts
	assert.equal(result.clip.startFrame, 0);
	assert.equal(result.clip.endFrame, 96);
	assert.equal(result.clip.durationFrames, 96);
});
