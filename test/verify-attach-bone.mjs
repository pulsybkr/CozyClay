#!/usr/bin/env node
/**
 * Carried props resolve their frame on a VRM avatar, not only on an FBX bot.
 *
 * This is the defect it was written for: a prop attached to `rightHand` on
 * Sakura or CHAR 02 resolved to NO node, so it rendered exactly as if detached
 * — carrying a cup was impossible on the avatars the studio actually ships —
 * while every existing test passed, because those tests use the Mixamo-named
 * FBX bots.
 *
 * The fixtures below are the real joint name and the real tag that
 * `vrm-runtime.js` writes while loading an avatar (`studioBoneName =
 * "mixamorig" + core`), taken from the shipped files: their humanoid bones are
 * `J_Bip_*`. The traversal order, the aliases and the untagged-raw-bone trap
 * are all reproduced, because each one changes the answer.
 */
import assert from "node:assert/strict";

import { attachBoneCandidateNames, findAttachBone, isAttachBoneMatch, isAttachableBone, normalizeRigBoneName } from "../src/attach-bone.js";
import { VRM_PHYSICS_BONES } from "../src/humanoid-rig.js";

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };

/** A node as three.js would present it. `object3d` is three-vrm's normalized
 * joint: not a Bone, which is why a `node.isBone` filter skips a whole VRM. */
const node = (name, { bone = true, studioBoneName = null, studioRawBoneName = null, aliases = [], children = [] } = {}) => {
	const self = { name, isBone: bone, children, traverse(visit) { visit(self); for (const child of children) child.traverse(visit); } };
	const userData = {};
	if (studioBoneName) userData.studioBoneName = studioBoneName;
	if (studioRawBoneName) userData.studioRawBoneName = studioRawBoneName;
	if (aliases.length) userData.studioBoneAliases = aliases;
	if (Object.keys(userData).length) self.userData = userData;
	return self;
};

/**
 * A shipped-style VRM rig: raw `J_Bip_*` bones, and the normalized joints
 * three-vrm adds, tagged exactly as `vrm-runtime.js` tags them.
 *
 * The joint spelling follows the real files (`J_Bip_R_Hand`), not the Mixamo
 * camelCase: using the convenient casing here would have hidden the defect this
 * suite exists for, since the whole problem is that a VRM does not name its
 * bones the Mixamo way.
 */
function vrmRig(core) {
	void core;
	const raw = node("J_Bip_Root", { studioRawBoneName: "mixamorigHips" });
	const joints = [];
	for (const [coreName, vrmName] of VRM_PHYSICS_BONES) {
		const rawBone = node(`J_Bip_${vrmName}`, { studioRawBoneName: `mixamorig${coreName}` });
		const normalized = node(`Normalized_J_Bip_${vrmName}`, { bone: false, studioBoneName: `mixamorig${coreName}` });
		raw.children.push(rawBone);
		joints.push(normalized);
	}
	const rig = node("Scene", { bone: false, children: [raw, ...joints] });
	rig.userData = { characterFormat: "vrm" };
	return { rig, normalized: joints, raw };
}

/** A shipped-style FBX bot: Mixamo names, ordinary bones, no tags. */
function fbxRig() {
	const names = ["mixamorigHips", "mixamorigSpine", "mixamorigHead", "mixamorigLeftArm", "mixamorigLeftForeArm",
		"mixamorigLeftHand", "mixamorigRightArm", "mixamorigRightForeArm", "mixamorigRightHand",
		"mixamorigLeftUpLeg", "mixamorigLeftLeg", "mixamorigLeftFoot", "mixamorigRightUpLeg", "mixamorigRightLeg", "mixamorigRightFoot"];
	const children = names.map((name) => node(name));
	const rig = node("Armature", { bone: false, children });
	return { rig };
}

const bones = (rig) => { const list = []; rig.traverse((entry) => list.push(entry)); return list; };
const isVrm = (rig) => rig.userData?.characterFormat === "vrm";

/* ------------------------------------------------------------- names ---- */

check("a name comparison ignores punctuation, case and separators", () => {
	assert.equal(normalizeRigBoneName("mixamorigRightHand"), "mixamorigrighthand");
	assert.equal(normalizeRigBoneName("J_Bip_R_Hand"), "jbiprhand");
	assert.equal(normalizeRigBoneName(""), "");
	assert.equal(normalizeRigBoneName(null), "");
});

check("a normalized VRM joint is a candidate even though it is not a Bone", () => {
	// three-vrm's normalized joints are plain Object3D, and they are the nodes
	// playback animates: refusing them is what broke every VRM in the first place.
	assert.equal(isAttachableBone(node("Normalized_x", { bone: false, studioBoneName: "mixamorigHead" })), true);
	assert.equal(isAttachableBone(node("mixamorigHead")), true);
	assert.equal(isAttachableBone(node("Scene", { bone: false })), false);
	assert.equal(isAttachableBone(null), false);
});

check("the candidate names put the studio tag first and the node name last", () => {
	const names = attachBoneCandidateNames(node("J_Bip_R_Hand", { studioBoneName: "mixamorigRightHand", studioRawBoneName: "mixamorigRightHand", aliases: ["mixamorigRightHandAlt"] }));
	assert.deepEqual(names, ["mixamorigRightHand", "mixamorigRightHandAlt", "J_Bip_R_Hand"]);
});

/* ---------------------------------------------------------------- FBX ---- */

check("an FBX bot keeps resolving exactly as before", () => {
	const { rig } = fbxRig();
	const list = bones(rig);
	for (const [track, expected] of [["rightHand", "mixamorigRightHand"], ["leftHand", "mixamorigLeftHand"], ["leftFoot", "mixamorigLeftFoot"], ["hips", "mixamorigHips"]]) {
		const found = findAttachBone(list, expected, { isVrm: false });
		assert.equal(found?.name, expected, `${track} must still find ${expected}`);
	}
});

/* ---------------------------------------------------------------- VRM ---- */

check("every hand, elbow, knee and foot frame resolves on a VRM", () => {
	// The studio's authored vocabulary is Mixamo's; the VRM's joints are not.
	// This is the mapping an attach goes through.
	for (const track of ["hips", "spine", "chest", "neck", "head", "leftShoulder", "leftElbow", "leftHand",
		"rightShoulder", "rightElbow", "rightHand", "leftKnee", "leftFoot", "rightKnee", "rightFoot"]) {
		const { rig } = vrmRig(track);
		const mixamo = { hips: "mixamorigHips", spine: "mixamorigSpine", chest: "mixamorigSpine1", neck: "mixamorigNeck", head: "mixamorigHead",
			leftShoulder: "mixamorigLeftShoulder", leftElbow: "mixamorigLeftForeArm", leftHand: "mixamorigLeftHand",
			rightShoulder: "mixamorigRightShoulder", rightElbow: "mixamorigRightForeArm", rightHand: "mixamorigRightHand",
			leftKnee: "mixamorigLeftLeg", leftFoot: "mixamorigLeftFoot", rightKnee: "mixamorigRightLeg", rightFoot: "mixamorigRightFoot" }[track];
		const found = findAttachBone(bones(rig), mixamo, { isVrm: true });
		assert.ok(found, `the "${track}" frame must resolve on a VRM (looked for ${mixamo})`);
		// It must be the NORMALIZED joint: that is the node playback animates.
		assert.equal(found.name.startsWith("Normalized_"), true, `${track} resolved to ${found.name}`);
	}
});

check("the two hands do not resolve to the same node", () => {
	const { rig } = vrmRig("rightHand");
	const list = bones(rig);
	const right = findAttachBone(list, "mixamorigRightHand", { isVrm: true });
	const left = findAttachBone(list, "mixamorigLeftHand", { isVrm: true });
	assert.notEqual(right, left, "a resolver that matched the wrong side would still return a frame");
	/* eslint-disable no-useless-escape */
	// The joint names carry VRM's own shape (`J_Bip_R_Hand`), so the assertion
	// targets the SIDE and not the studio's camelCase spelling.
	assert.match(right.name, /_R_Hand$|righthand$/i, right.name);
	assert.match(left.name, /_L_Hand$|lefthand$/i, left.name);
});

check("a raw VRM bone is not paired with a Mixamo name by accident", () => {
	// `J_Bip_C_Hips` normalizes to `jbipchips`, which ENDS WITH `hips`. Left
	// unguarded, the suffix rule pairs torso joints by coincidence while the
	// hands match nothing — simultaneously too generous and too strict. This
	// rig has NO tagged joints, which is what an older or foreign avatar looks
	// like, and the answer must be "nothing", not "a guess".
	const { raw } = vrmRig("hips");
	const list = bones(raw);
	for (const mixamo of ["mixamorigHips", "mixamorigHead", "mixamorigRightHand"]) {
		assert.equal(findAttachBone(list, mixamo, { isVrm: true }), null, `${mixamo} must not match by accident`);
	}
});

check("the VRM guard is what refuses a raw bone, not the absence of a tag", () => {
	// A raw VRM bone carries `studioRawBoneName` (`mixamorigHips`), so it WOULD
	// match the authored track on names alone — riding a node that three-vrm
	// updates a beat later than the normalized joint playback animates. The
	// guard above is therefore load-bearing, and this proves exactly that by
	// showing both answers on the same node.
	const { raw } = vrmRig("hips");
	const list = bones(raw);
	const hip = list.find((entry) => entry.userData?.studioRawBoneName === "mixamorigHips");
	assert.ok(hip, "the fixture carries the raw tag the loader writes");
	assert.equal(isAttachBoneMatch(hip, "mixamorigHips", { isVrm: true }), false, "on a VRM the raw bone is refused");
	assert.equal(isAttachBoneMatch(hip, "mixamorigHips", { isVrm: false }), true, "and it is the tag that made it matchable at all");
});

check("an untagged VRM joint matches nothing, whatever its name suggests", () => {
	// The suffix rule is what pairs `J_Bip_C_Hips` with `hips` by accident. On a
	// VRM the answer must be "nothing" rather than a coincidence.
	const untagged = node("J_Bip_C_Hips");
	const rig = node("Scene", { bone: false, children: [untagged] });
	rig.userData = { characterFormat: "vrm" };
	assert.equal(findAttachBone(bones(rig), "mixamorigHips", { isVrm: true }), null);
});

check("the optional spine aliases answer for chest and upper chest", () => {
	// vrm-runtime.js aliases the normalized chest node, because a VRM may lack
	// upperChest; both `chest` and `upperChest` must reach it.
	const normalized = node("Normalized_chest", { bone: false, studioBoneName: "mixamorigSpine1", aliases: ["mixamorigSpine2"] });
	const rig = node("Scene", { bone: false, children: [normalized] });
	const list = bones(rig);
	for (const mixamo of ["mixamorigSpine1", "mixamorigSpine2"]) {
		assert.equal(findAttachBone(list, mixamo, { isVrm: true }), normalized, mixamo);
	}
});

check("traversal order decides between duplicate names, the same way every frame", () => {
	// IK may leave the raw bone and a normalized copy both matching; a prop that
	// alternated between them would visibly flicker, so first-in-traversal wins.
	const first = node("mixamorigRightHand");
	const second = node("Normalized_RightHand", { bone: false, studioBoneName: "mixamorigRightHand" });
	const rig = node("Armature", { bone: false, children: [first, second] });
	assert.equal(findAttachBone(bones(rig), "mixamorigRightHand", { isVrm: false }), first);
});

check("an unknown track resolves to nothing instead of to a random bone", () => {
	const { rig } = vrmRig("head");
	assert.equal(findAttachBone(bones(rig), "mixamorigTail", { isVrm: true }), null);
	assert.equal(findAttachBone(bones(rig), "", { isVrm: true }), null);
	assert.equal(findAttachBone(bones(rig), null, { isVrm: true }), null);
});

check("a match needs the name to agree, not merely to exist", () => {
	const { rig } = vrmRig("head");
	const head = findAttachBone(bones(rig), "mixamorigHead", { isVrm: true });
	assert.equal(isAttachBoneMatch(head, "mixamorigHead", { isVrm: true }), true);
	assert.equal(isAttachBoneMatch(head, "mixamorigNeck", { isVrm: true }), false);
	assert.equal(isAttachBoneMatch(node("Scene", { bone: false }), "mixamorigHead", { isVrm: true }), false);
});

check("the shipped avatar vocabulary is what the fixtures reproduce", () => {
	// If VRM_PHYSICS_BONES ever drops a hand entry, the fixture would stop
	// covering it and these checks would quietly pass on a smaller surface.
	for (const core of ["Hips", "Head", "LeftHand", "RightHand", "LeftFoot", "RightFoot", "LeftForeArm", "RightForeArm"]) {
		assert.ok(VRM_PHYSICS_BONES.some(([name]) => name === core), `${core} must stay in the VRM bone vocabulary`);
	}
});

console.log(`attach-bone: ${checks.length} checks passed`);
