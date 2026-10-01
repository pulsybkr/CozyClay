/**
 * Tests : InteractionTrack, expressions, pacing.
 * Spec : 05-compilation-3d §§6–7, 06-correctifs C6/C8.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createInteractionEvent,
	createInteractionTrack,
	evalPropState,
	computeWorldTransformAtContact,
	PROP_STATE,
} from "../src/production/interaction-track.js";

import {
	resolveExpression,
	createExpressionTrack,
	createExpressionKey,
	buildExpressionTrackFromActions,
} from "../src/production/expressions.js";

import {
	analyzeCompositionPacing,
	planPacingSegments,
	applyPacingToClip,
	PACE_LABEL,
} from "../src/production/pacing.js";

// ===========================================================================
// Section A : InteractionTrack
// ===========================================================================

// ---------------------------------------------------------------------------
// A1. État avant contact (on-support)
// ---------------------------------------------------------------------------
test("Interaction: prop is ON_SUPPORT before startFrame", () => {
	const ev = createInteractionEvent({
		objectId: "CUP",
		characterId: "CHAR_A",
		kind: "pick-up",
		hand: "right",
		startFrame: 192,
		contactFrame: 240,
		endFrameExclusive: 288,
	});

	const result = evalPropState(ev, 191);
	assert.equal(result.state, PROP_STATE.ON_SUPPORT);
	assert.equal(result.ikRequired, false);
});

// ---------------------------------------------------------------------------
// A2. Phase d'approche (approaching)
// ---------------------------------------------------------------------------
test("Interaction: prop is APPROACHING between startFrame and contactFrame", () => {
	const ev = createInteractionEvent({
		objectId: "CUP",
		characterId: "CHAR_A",
		kind: "pick-up",
		hand: "right",
		startFrame: 192,
		contactFrame: 240,
		endFrameExclusive: 288,
	});

	const result = evalPropState(ev, 216); // milieu de l'approche
	assert.equal(result.state, PROP_STATE.APPROACHING);
	assert.equal(result.ikRequired, true);
	// alpha ≈ 0.5 (216-192) / (240-192) = 24/48 = 0.5
	assert.ok(Math.abs(result.alpha - 0.5) < 0.01, `alpha should be 0.5, got ${result.alpha}`);
});

// ---------------------------------------------------------------------------
// A3. Phase de port (held)
// ---------------------------------------------------------------------------
test("Interaction: prop is HELD at contactFrame", () => {
	const ev = createInteractionEvent({
		objectId: "CUP",
		characterId: "CHAR_A",
		kind: "pick-up",
		hand: "right",
		startFrame: 192,
		contactFrame: 240,
		endFrameExclusive: 288,
	});

	const result = evalPropState(ev, 240);
	assert.equal(result.state, PROP_STATE.HELD);
	assert.equal(result.ikRequired, false);
	assert.equal(result.alpha, 1);
});

// ---------------------------------------------------------------------------
// A4. Phase de release (world figé)
// ---------------------------------------------------------------------------
test("Interaction: prop is RELEASED after releaseFrame with frozen world transform", () => {
	const ev = createInteractionEvent({
		objectId: "CUP",
		characterId: "CHAR_A",
		kind: "pick-up",
		hand: "right",
		startFrame: 192,
		contactFrame: 216,
		endFrameExclusive: 288,
		releaseFrame: 264,
	});

	const result = evalPropState(ev, 270);
	assert.equal(result.state, PROP_STATE.RELEASED);
	// alpha = (270-264)/(288-264) = 6/24 = 0.25
	assert.ok(Math.abs(result.alpha - 0.25) < 0.01);
});

// ---------------------------------------------------------------------------
// A5. Après endFrameExclusive → on-support
// ---------------------------------------------------------------------------
test("Interaction: prop returns to ON_SUPPORT after endFrameExclusive", () => {
	const ev = createInteractionEvent({
		objectId: "CUP",
		characterId: "CHAR_A",
		kind: "pick-up",
		hand: "right",
		startFrame: 192,
		contactFrame: 216,
		endFrameExclusive: 288,
	});

	const result = evalPropState(ev, 288);
	assert.equal(result.state, PROP_STATE.ON_SUPPORT);
});

// ---------------------------------------------------------------------------
// A6. Scrub inverse : frame avant contact après avoir été à contact
// ---------------------------------------------------------------------------
test("Interaction: scrub back from HELD to APPROACHING is deterministic", () => {
	const ev = createInteractionEvent({
		objectId: "CUP",
		characterId: "CHAR_A",
		kind: "pick-up",
		hand: "right",
		startFrame: 192,
		contactFrame: 240,
		endFrameExclusive: 288,
	});

	// En avant
	const atContact = evalPropState(ev, 240);
	assert.equal(atContact.state, PROP_STATE.HELD);

	// En arrière (scrub back)
	const beforeContact = evalPropState(ev, 200);
	assert.equal(beforeContact.state, PROP_STATE.APPROACHING);
	assert.ok(beforeContact.ikRequired);
});

// ---------------------------------------------------------------------------
// A7. createInteractionTrack — chevauchement sur même objet → erreur
// ---------------------------------------------------------------------------
test("Interaction: overlapping events for same objectId throw RangeError", () => {
	const ev1 = createInteractionEvent({
		objectId: "CUP", characterId: "A", kind: "pick-up", hand: "right",
		startFrame: 0, contactFrame: 48, endFrameExclusive: 96,
	});
	const ev2 = createInteractionEvent({
		objectId: "CUP", characterId: "B", kind: "pick-up", hand: "left",
		startFrame: 80, contactFrame: 90, endFrameExclusive: 150, // overlap!
	});
	assert.throws(() => createInteractionTrack([ev1, ev2]), RangeError);
});

// ---------------------------------------------------------------------------
// A8. InteractionTrack.isExpectedContact filtre correctement
// ---------------------------------------------------------------------------
test("Interaction: isExpectedContact filters expected hand/prop pairs at contact", () => {
	const ev = createInteractionEvent({
		objectId: "CUP", characterId: "CHAR_A", kind: "pick-up", hand: "right",
		startFrame: 0, contactFrame: 24, endFrameExclusive: 96,
	});
	const track = createInteractionTrack([ev]);

	// À la frame de contact → attendu
	assert.ok(track.isExpectedContact("CUP", "CHAR_A", 24));
	// Avant contact → pas attendu
	assert.ok(!track.isExpectedContact("CUP", "CHAR_A", 10));
	// Autre personnage → pas attendu
	assert.ok(!track.isExpectedContact("CUP", "CHAR_B", 24));
});

// ---------------------------------------------------------------------------
// A9. verifyIKCapability — contact sans IK → unsupported
// ---------------------------------------------------------------------------
test("Interaction: verifyIKCapability marks approach contacts unsupported when IK unavailable", () => {
	const ev = createInteractionEvent({
		objectId: "CUP", characterId: "CHAR_A", kind: "pick-up", hand: "right",
		startFrame: 0, contactFrame: 48, // approche IK > 0 frames
		endFrameExclusive: 96,
	});
	const track = createInteractionTrack([ev]);

	const { verifiedContacts, unsupported } = track.verifyIKCapability(false);
	assert.equal(verifiedContacts.length, 0);
	assert.ok(unsupported.length > 0);
	assert.ok(unsupported[0].includes("approach-ik-unsupported"));
});

// ---------------------------------------------------------------------------
// A10. computeWorldTransformAtContact — continuité sans saut
// ---------------------------------------------------------------------------
test("Interaction: computeWorldTransformAtContact composes hand and grip transforms", () => {
	const hand = { position: [1, 1, 0], quaternion: [0, 0, 0, 1] }; // identité
	const grip = { position: [0.1, 0, 0], quaternion: [0, 0, 0, 1] }; // décalage local
	const result = computeWorldTransformAtContact(hand, grip);

	// Avec quaternion identité : position = hand + grip
	assert.ok(Math.abs(result.position[0] - 1.1) < 0.001);
	assert.ok(Math.abs(result.position[1] - 1.0) < 0.001);
	assert.ok(Math.abs(result.position[2] - 0.0) < 0.001);
});

// ===========================================================================
// Section B : Expressions
// ===========================================================================

// ---------------------------------------------------------------------------
// B1. Résolution directe d'un nom VRM disponible
// ---------------------------------------------------------------------------
test("Expressions: resolveExpression returns direct match when available", () => {
	const available = new Set(["happy", "sad", "blink"]);
	const { resolved, unsupported } = resolveExpression("happy", available);
	assert.equal(resolved, "happy");
	assert.equal(unsupported, false);
});

// ---------------------------------------------------------------------------
// B2. Résolution via table narrative → preset
// ---------------------------------------------------------------------------
test("Expressions: resolveExpression maps narrative name to VRM preset", () => {
	const available = new Set(["happy", "sad", "surprised"]);
	const { resolved, unsupported } = resolveExpression("smile", available); // smile → happy
	assert.equal(resolved, "happy");
	assert.equal(unsupported, false);
});

// ---------------------------------------------------------------------------
// B3. Expression absente → unsupported, jamais succès fictif
// ---------------------------------------------------------------------------
test("Expressions: resolveExpression reports unsupported when expression not on VRM", () => {
	const available = new Set(["happy", "sad"]);
	const { resolved, unsupported } = resolveExpression("zApocalypse", available);
	assert.equal(resolved, null);
	assert.equal(unsupported, true);
});

// ---------------------------------------------------------------------------
// B4. ExpressionTrack — evalAt interpolation linéaire
// ---------------------------------------------------------------------------
test("Expressions: ExpressionTrack.evalAt interpolates linearly between keys", () => {
	const track = createExpressionTrack([
		createExpressionKey({ frame: 0, expression: "happy", weight: 0 }),
		createExpressionKey({ frame: 24, expression: "happy", weight: 1 }),
	]);

	assert.ok(Math.abs(track.evalAt("happy", 0) - 0) < 0.01);
	assert.ok(Math.abs(track.evalAt("happy", 12) - 0.5) < 0.01);
	assert.ok(Math.abs(track.evalAt("happy", 24) - 1) < 0.01);
});

// ---------------------------------------------------------------------------
// B5. ExpressionTrack — activeAt retourne les expressions avec weight > 0
// ---------------------------------------------------------------------------
test("Expressions: ExpressionTrack.activeAt returns active expressions at a frame", () => {
	const track = createExpressionTrack([
		createExpressionKey({ frame: 0, expression: "happy", weight: 1 }),
		createExpressionKey({ frame: 24, expression: "happy", weight: 0 }),
		createExpressionKey({ frame: 0, expression: "blink", weight: 0 }),
	]);

	const active = track.activeAt(12);
	assert.ok(active.has("happy"));
	assert.ok(!active.has("blink")); // weight 0 à frame 12
});

// ---------------------------------------------------------------------------
// B6. buildExpressionTrackFromActions — actions narratives
// ---------------------------------------------------------------------------
test("Expressions: buildExpressionTrackFromActions skips unsupported expressions", () => {
	const actions = [
		{ type: "expression", expression: "happy", startSeconds: 0, endSeconds: 1 },
		{ type: "expression", expression: "nonExistent", startSeconds: 1, endSeconds: 2 },
	];
	const available = new Set(["happy", "sad"]);
	const { track, unsupported } = buildExpressionTrackFromActions(actions, available);

	// "happy" est dans le track
	assert.ok(track.evalAt("happy", 0) > 0 || track.evalAt("happy", 12) > 0);
	// "nonExistent" est dans unsupported
	assert.ok(unsupported.length > 0);
	assert.ok(unsupported.some((u) => u.includes("nonExistent")));
});

// ---------------------------------------------------------------------------
// B7. Clés datées indépendantes des clips corporels
// ---------------------------------------------------------------------------
test("Expressions: expression keys are independent of motion clips (different time domain)", () => {
	// La piste d'expression a ses propres frames locales ; aucune dépendance sur clip
	const track = createExpressionTrack([
		createExpressionKey({ frame: 48, expression: "sad", weight: 1, interpolation: "step" }),
	]);

	// Avant la clé → weight 1 (extrapolation au bord)
	assert.equal(track.evalAt("sad", 0), 1);
	// À la clé → weight 1
	assert.equal(track.evalAt("sad", 48), 1);
	// Expressions absentes → weight 0
	assert.equal(track.evalAt("happy", 48), 0);
});

// ===========================================================================
// Section C : Pacing (composition)
// ===========================================================================

// ---------------------------------------------------------------------------
// C1. Salut statique (wave root immobile) → pas dead-air car joints actifs
// ---------------------------------------------------------------------------
test("Pacing: static root wave is not dead-air when joints are active", () => {
	// Frames avec rootDx≈0 mais jointEnergies élevés (salut actif)
	const frames = Array.from({ length: 48 }, (_, i) => ({
		rootDx: 0.001, rootDz: 0, rootRotY: 0,
		jointEnergies: [0.05, 0.08, 0.06, 0.07], // articulations actives
	}));
	const analysis = analyzeCompositionPacing({ frames }, { characterHeight: 1.7 });
	assert.ok(analysis.enough);
	// Les frames devraient être IDLE ou ACTIVE, pas DEAD_AIR
	const deadAirCount = analysis.labels.filter((l) => l === PACE_LABEL.DEAD_AIR).length;
	assert.equal(deadAirCount, 0, "static root wave should not be classified as dead-air");
});

// ---------------------------------------------------------------------------
// C2. Marche → active
// ---------------------------------------------------------------------------
test("Pacing: walking frames are classified as ACTIVE", () => {
	const frames = Array.from({ length: 48 }, () => ({
		rootDx: 0.05, rootDz: 0.02, rootRotY: 0.01,
		jointEnergies: [0.02, 0.03, 0.02],
	}));
	const analysis = analyzeCompositionPacing({ frames }, { characterHeight: 1.7, fps: 24 });
	assert.ok(analysis.enough);
	const activeCount = analysis.labels.filter((l) => l === PACE_LABEL.ACTIVE).length;
	assert.ok(activeCount > 0, "walking should produce ACTIVE labels");
});

// ---------------------------------------------------------------------------
// C3. Deux appels identiques → changed:false (idempotence)
// ---------------------------------------------------------------------------
test("Pacing: planPacingSegments is idempotent (changed:false on identical second call)", () => {
	const frames = Array.from({ length: 48 }, () => ({
		rootDx: 0, rootDz: 0, rootRotY: 0,
		jointEnergies: [0, 0],
	}));
	const analysis = analyzeCompositionPacing({ frames });
	const result1 = planPacingSegments(analysis, { speedup: 1.5 });
	// Simuler que le speedup 1.5 est déjà appliqué
	const result2 = planPacingSegments(analysis, { speedup: 1.5, currentSpeedup: 1.5 });
	assert.equal(result2.changed, false);
});

// ---------------------------------------------------------------------------
// C4. Contact protégé → rate=1 même si dead-air
// ---------------------------------------------------------------------------
test("Pacing: protected contact frames have rate=1 and are never sped up", () => {
	// Frames toutes immobiles MAIS une protégée
	const frames = Array.from({ length: 24 }, () => ({
		rootDx: 0, rootDz: 0, rootRotY: 0,
		jointEnergies: [0],
	}));
	const protectedFrames = new Set([10, 11, 12]); // contact à frame 10-12
	const analysis = analyzeCompositionPacing({ frames }, { protectedFrames });

	// Les frames protégées doivent être classées CONTACT
	assert.equal(analysis.labels[10], PACE_LABEL.CONTACT);
	assert.equal(analysis.labels[11], PACE_LABEL.CONTACT);

	const { segments } = planPacingSegments(analysis, { speedup: 2.0 });
	const contactSegs = segments.filter((s) => s.label === PACE_LABEL.CONTACT);
	for (const seg of contactSegs) {
		assert.equal(seg.rate, 1.0, "contact segments must not be sped up");
	}
});

// ---------------------------------------------------------------------------
// C5. applyPacingToClip idempotence
// ---------------------------------------------------------------------------
test("Pacing: applyPacingToClip returns changed:false when segments match", () => {
	const segs = [{ srcStart: 0, srcEnd: 24, rate: 1.5, label: "dead-air" }];
	const clip = { id: "clip-A", segments: segs };
	const { changed } = applyPacingToClip(clip, segs);
	assert.equal(changed, false);
});

// ---------------------------------------------------------------------------
// C6. applyPacingToClip — changed:true quand segments différents
// ---------------------------------------------------------------------------
test("Pacing: applyPacingToClip returns changed:true when new segments differ", () => {
	const oldSegs = [{ srcStart: 0, srcEnd: 24, rate: 1.0 }];
	const newSegs = [{ srcStart: 0, srcEnd: 24, rate: 1.5 }];
	const clip = { id: "clip-A", segments: oldSegs };
	const { changed, clip: updated } = applyPacingToClip(clip, newSegs);
	assert.equal(changed, true);
	assert.equal(updated.segments[0].rate, 1.5);
});

// ---------------------------------------------------------------------------
// C7. Trop peu de frames → enough:false
// ---------------------------------------------------------------------------
test("Pacing: analyzeCompositionPacing returns enough:false for too-short clips", () => {
	const frames = [{ rootDx: 0, rootDz: 0, rootRotY: 0, jointEnergies: [] }];
	const analysis = analyzeCompositionPacing({ frames });
	assert.equal(analysis.enough, false);
	assert.equal(analysis.reason, "too-few-frames");
});
