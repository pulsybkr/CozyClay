/**
 * Which rig node carries a carried prop's frame.
 *
 * A prop attached to a character rides a bone: `rightHand` for a cup, `hips`
 * for something strapped on. Two vocabularies meet here, and the mismatch
 * between them was a real defect:
 *
 *  - the studio's authored vocabulary is Mixamo's (`rightHand` -> `mixamorigRightHand`);
 *  - an FBX bot is named that way, so the obvious rule worked;
 *  - a VRM avatar names its joints after its own convention (`J_Bip_R_Hand`),
 *    so the same rule found NOTHING: a prop attached to a hand on Sakura or
 *    CHAR 02 rendered exactly like a detached prop, and carrying anything was
 *    impossible on the very avatars this studio ships.
 *
 * `vrm-runtime.js` already tags those joints with `studioBoneName` while it
 * loads them, and `ardy/ik.js` resolves IK against that tag — which is why IK
 * has always worked on a VRM. This module is the same decision, kept pure so
 * the rule can be tested without three.js, a renderer or an avatar file.
 *
 * Two traps are worth naming because both look correct until they are not:
 *
 *  - `node.isBone` alone skips a VRM entirely. three-vrm's normalized joints
 *    are plain `Object3D`; they are the nodes playback actually animates, so
 *    they are the frame a prop wants. `isPoseBone` accepts them.
 *  - The loose suffix rule pairs strings by accident. On a VRM, `J_Bip_C_Hips`
 *    normalizes to `jbipchips`, which ENDS WITH `hips` — and `J_Bip_R_Hand`
 *    does not end with `righthand`, so the rule is simultaneously too generous
 *    on the torso and too strict on the hands. On a VRM only TAGGED joints are
 *    candidates, which is what `ardy/ik.js` already does for the same reason.
 */

/** Drop punctuation and case, the project's one name-comparison rule. */
export function normalizeRigBoneName(name) {
	return String(name ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/** A node the pose/skin vocabulary can address: a real bone, or a VRM's
 * normalized joint, which three-vrm tags with `studioBoneName`. */
export function isAttachableBone(node) {
	return Boolean(node && (node.isBone || node.userData?.studioBoneName));
}

/**
 * Every name a node may be addressed by, most specific first.
 *
 * `studioBoneName` is the studio's own Mixamo-spelled tag and wins; the raw
 * tag is the avatar's own joint identity; the aliases exist because a VRM's
 * optional spine segments have no 1:1 counterpart; the node name is the last
 * resort, and it is what makes a plain FBX rig work.
 */
export function attachBoneCandidateNames(node) {
	const names = [];
	const push = (value) => { if (typeof value === "string" && value && !names.includes(value)) names.push(value); };
	push(node?.userData?.studioBoneName);
	push(node?.userData?.studioRawBoneName);
	for (const alias of node?.userData?.studioBoneAliases ?? []) push(alias);
	push(node?.name);
	return names;
}

/**
 * Whether `node` can serve as the frame for the authored track `mixamoName`
 * on the rig it belongs to.
 *
 * `isVrm` is not cosmetic, and the precise test matters. `vrm-runtime.js` tags a
 * VRM twice: the NORMALIZED joint (which playback animates) gets
 * `studioBoneName`, and the raw bone gets `studioRawBoneName`. Both end up
 * matching a Mixamo name, so the choice between them decides which node a prop
 * rides — and riding the raw bone risks being a frame behind, because
 * three-vrm copies the normalized pose onto it during its own update. So a VRM
 * accepts ONLY the normalized tag, which is exactly the rule `ardy/ik.js`
 * already applies for the same reason: IK on a VRM writes the normalized
 * joints, and it has always worked.
 *
 * The same guard also refuses an untagged VRM joint, whose name follows the
 * avatar's own convention and can therefore only ever match by accident.
 */
export function isAttachBoneMatch(node, mixamoName, { isVrm = false } = {}) {
	if (!isAttachableBone(node)) return false;
	if (isVrm && !node.userData?.studioBoneName) return false;
	const target = normalizeRigBoneName(mixamoName);
	if (!target) return false;
	return attachBoneCandidateNames(node).some((name) => {
		const norm = normalizeRigBoneName(name);
		return norm === target || norm.endsWith(target);
	});
}

/**
 * The first node in traversal order that answers `mixamoName`, or null.
 *
 * Depth-first from the rig root, so a rig with two joints of the same name
 * resolves the same way every frame — `poses.js` and `ardy/playback.js` agree
 * on that order, and a carried prop that jumped between two candidates would
 * visibly flicker.
 */
export function findAttachBone(nodes, mixamoName, { isVrm = false } = {}) {
	for (const node of nodes) if (isAttachBoneMatch(node, mixamoName, { isVrm })) return node;
	return null;
}
