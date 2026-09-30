import { expressionWeight } from "./facial-expressions.js";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { CSKEL27_JOINTS } from "./ardy/cskel27.js";
import { CSKEL27_NEUTRAL } from "./ardy/cskel27-neutral.js";
import { globalRotations } from "./ardy/convert.js";
import { primeBindPose } from "./poses.js";
import { VRM_PHYSICS_BONES } from "./humanoid-rig.js";

// Runtime objects must never enter userData: Object3D.clone JSON-serializes it.
const runtimes = new WeakMap();
export const vrmRuntime = rig => runtimes.get(rig) ?? null;

const CORE_TO_VRM = [
	["Hips", "hips"], ["Spine1", "spine"], ["Spine2", "chest"], ["Spine3", "upperChest"],
	["Neck", "neck"], ["Head", "head"],
	["RightShoulder", "rightShoulder"], ["RightArm", "rightUpperArm"], ["RightForeArm", "rightLowerArm"],
	["RightHand", "rightHand"], ["LeftShoulder", "leftShoulder"], ["LeftArm", "leftUpperArm"],
	["LeftForeArm", "leftLowerArm"], ["LeftHand", "leftHand"],
	["RightUpLeg", "rightUpperLeg"], ["RightLeg", "rightLowerLeg"], ["RightFoot", "rightFoot"], ["RightToeBase", "rightToes"],
	["LeftUpLeg", "leftUpperLeg"], ["LeftLeg", "leftLowerLeg"], ["LeftFoot", "leftFoot"], ["LeftToeBase", "leftToes"],
];

export async function loadVrm(url) {
	const loader = new GLTFLoader();
	loader.register(parser => new VRMLoaderPlugin(parser));
	const gltf = await loader.loadAsync(url);
	const vrm = gltf.userData.vrm;
	if (!vrm) throw new Error("The file does not contain a VRM avatar.");
	// Record the public humanoid's rest conversion before VRM0 rotates its scene.
	// Private evaluation clones use these bases to sync the borrowed skinned mesh.
	const syncPairs = Object.entries(vrm.humanoid.normalizedHumanBones).map(([name, { node }]) => {
		const raw = vrm.humanoid.getRawBoneNode(name);
		raw.parent.updateWorldMatrix(true, false);
		return { node, raw, parentBind: raw.parent.getWorldQuaternion(new THREE.Quaternion()), rawBind: raw.quaternion.clone() };
	});
	VRMUtils.rotateVRM0(vrm);
	// Secondary motion is deliberately disabled until fixed-step export is supported.
	vrm.springBoneManager?.reset();
	const rig = vrm.scene;
	rig.userData.characterFormat = "vrm";
	for (const [core, name] of VRM_PHYSICS_BONES) {
		const normalized = vrm.humanoid.getNormalizedBoneNode(name), raw = vrm.humanoid.getRawBoneNode(name);
		if (normalized) normalized.userData.studioBoneName = `mixamorig${core}`;
		if (raw) raw.userData.studioRawBoneName = `mixamorig${core}`;
	}
	// Upper chest/chest are optional in VRM. Explicit aliases keep the spine
	// vocabulary usable without inventing bones or deforming the hierarchy.
	for (const [core, names] of [['Spine1',['chest','spine']],['Spine2',['upperChest','chest','spine']]]) {
		const node = names.map(name => vrm.humanoid.getNormalizedBoneNode(name)).find(Boolean);
		if (node && node.userData.studioBoneName !== `mixamorig${core}`)
			node.userData.studioBoneAliases = [...(node.userData.studioBoneAliases ?? []), `mixamorig${core}`];
	}
	primeBindPose(rig);
	for (const side of ['left','right']) {
		const arm = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`);
		if (arm) arm.userData.studioRestQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), side === 'left' ? -1.2 : 1.2).toArray();
	}
	rig.updateMatrixWorld(true);
	const hips = vrm.humanoid.getNormalizedBoneNode("hips");
	const leftFoot = vrm.humanoid.getNormalizedBoneNode("leftFoot");
	if (!hips || !leftFoot) {
		VRMUtils.deepDispose(rig);
		throw new Error("The avatar is missing required humanoid bones (hips/feet).");
	}
	const inverse = rig.matrixWorld.clone().invert();
	const hipsPosition = hips.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
	const footPosition = leftFoot.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
	const coreHips = CSKEL27_NEUTRAL[0];
	const coreFoot = CSKEL27_NEUTRAL[CSKEL27_JOINTS.indexOf("LeftFoot")];
	const legRatio = (hipsPosition.y - footPosition.y) / (coreHips[1] - coreFoot[1]);
	if (!Number.isFinite(legRatio) || legRatio <= 0) {
		VRMUtils.deepDispose(rig);
		throw new Error("The avatar has invalid humanoid proportions.");
	}
	const rootInverseQuat = rig.getWorldQuaternion(new THREE.Quaternion()).invert();
	const bones = CORE_TO_VRM.flatMap(([core, name]) => {
		const node = vrm.humanoid.getNormalizedBoneNode(name);
		return node ? [{ core: CSKEL27_JOINTS.indexOf(core), name, node,
			bindGlobal: node.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInverseQuat),
			bindPosition: node.position.clone() }] : [];
	});
	rig.traverse(node => {
		if (node.isMesh) {
			node.castShadow = true;
			node.receiveShadow = true;
			node.frustumCulled = false;
		}
	});
	const runtime = { vrm, bones, hips, hipsPosition, legRatio, syncPairs, poseNodes: syncPairs.map(pair => pair.node) };
	runtimes.set(rig, runtime);
	return rig;
}

export function syncVrm(rig) {
	const runtime = vrmRuntime(rig);
	if (!runtime) return;
	runtime.vrm.humanoid.update();
	runtime.vrm.expressionManager?.update();
	rig.updateMatrixWorld(true);
}

export function setVrmStandingPose(rig) {
	const runtime = vrmRuntime(rig);
	if (!runtime) return;
	runtime.vrm.humanoid.resetNormalizedPose();
	// Normalized VRM bones use canonical T-pose axes, not Mixamo local axes.
	runtime.vrm.humanoid.getNormalizedBoneNode("leftUpperArm")?.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1.2);
	runtime.vrm.humanoid.getNormalizedBoneNode("rightUpperArm")?.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.2);
	syncVrm(rig);
}

export function applyVrmMotionFrame(rig, motion, frame) {
	const runtime = vrmRuntime(rig);
	if (!runtime || !motion) return;
	const f = Math.max(0, Math.min(Math.round(frame) || 0, motion.frames - 1));
	const anchor = Math.max(0, Math.min(motion.anchorFrame || 0, motion.frames - 1));
	const locals = CSKEL27_JOINTS.map((_, j) => {
		const o = (f * 27 + j) * 9;
		return [Array.from(motion.rotMats.slice(o, o + 3)), Array.from(motion.rotMats.slice(o + 3, o + 6)), Array.from(motion.rotMats.slice(o + 6, o + 9))];
	});
	const globals = globalRotations(locals);
	const rootQuaternion = rig.getWorldQuaternion(new THREE.Quaternion());
	for (const bone of runtime.bones) {
		const m = globals[bone.core];
		const matrix = new THREE.Matrix4().set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1);
		const desired = new THREE.Quaternion().setFromRotationMatrix(matrix).multiply(bone.bindGlobal).premultiply(rootQuaternion);
		bone.node.parent.updateWorldMatrix(true, false);
		bone.node.quaternion.copy(bone.node.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
		bone.node.position.copy(bone.bindPosition);
		bone.node.updateMatrixWorld(true);
	}
	// Preserve the avatar's own limb lengths. Only hips translation is retargeted.
	const root = f * 27 * 3, anchorRoot = anchor * 27 * 3;
	const neutralY = CSKEL27_NEUTRAL[0][1];
	const floorShift = -Math.min(...CSKEL27_NEUTRAL.map(joint => joint[1]));
	const target = runtime.hipsPosition.clone().add(new THREE.Vector3(
		motion.posedJoints[root] - motion.posedJoints[anchorRoot],
		motion.posedJoints[root + 1] - (neutralY + floorShift),
		motion.posedJoints[root + 2] - motion.posedJoints[anchorRoot + 2],
	).multiplyScalar(runtime.legRatio));
	rig.updateWorldMatrix(true, false);
	target.applyMatrix4(rig.matrixWorld);
	runtime.hips.parent.updateWorldMatrix(true, false);
	runtime.hips.position.copy(runtime.hips.parent.worldToLocal(target));
	syncVrm(rig);
}

export function snapshotVrmBones(rig) {
	const runtime = vrmRuntime(rig);
	if (!runtime) return null;
	return runtime.poseNodes.map(node => [node, node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w, node.position.x, node.position.y, node.position.z]);
}

/** Attach only the normalized-body playback runtime to a SkeletonUtils clone.
 * Assets are borrowed; the clone never owns the live VRM or expression manager.
 */
export function attachVrmEvaluationClone(source, clone) {
	const runtime = vrmRuntime(source);
	if (!runtime) return false;
	const original = [], copies = [];
	source.traverse(node => original.push(node)); clone.traverse(node => copies.push(node));
	const map = new Map(original.map((node,i) => [node,copies[i]]));
	const pairs = runtime.syncPairs.map(pair => ({ ...pair, node: map.get(pair.node), raw: map.get(pair.raw) }));
	const humanoid = { update() {
		for (const {node,raw,parentBind,rawBind} of pairs) {
			raw.quaternion.copy(parentBind).invert().multiply(node.quaternion).multiply(parentBind).multiply(rawBind);
			if (node === map.get(runtime.hips)) {
				raw.parent.updateWorldMatrix(true, false);
				raw.position.copy(raw.parent.worldToLocal(node.getWorldPosition(new THREE.Vector3())));
			}
		}
	} };
	runtimes.set(clone, { ...runtime, vrm: { humanoid },
		bones: runtime.bones.map(bone => ({ ...bone, node: map.get(bone.node) })),
		hips: map.get(runtime.hips), syncPairs: pairs, poseNodes: runtime.poseNodes.map(node => map.get(node)) });
	return true;
}

export function releaseVrmEvaluationClone(rig) { runtimes.delete(rig); }

export function disposeVrm(rig) {
	if (!rig) return;
	runtimes.delete(rig);
	VRMUtils.deepDispose(rig);
}

export function supportedVrmExpressions(rig) {
 const manager = vrmRuntime(rig)?.vrm.expressionManager;
 return manager ? Object.entries(manager.expressionMap).map(([name, expression]) => ({ name, isBinary: expression.isBinary })) : [];
}
export function applyVrmExpressions(rig, tracks = [], seconds = 0) {
 const manager = vrmRuntime(rig)?.vrm.expressionManager;
 if (!manager) return;
 for (const name of Object.keys(manager.expressionMap)) manager.setValue(name, 0);
 for (const track of tracks) if (manager.getExpression(track.expression)) manager.setValue(track.expression, expressionWeight(track.keys, seconds));
 manager.update();
}
export function snapshotVrmExpressions(rig) {
 const manager = vrmRuntime(rig)?.vrm.expressionManager;
 return manager ? Object.keys(manager.expressionMap).map(name => [name, manager.getValue(name)]) : [];
}
export function restoreVrmExpressions(rig, values = []) {
 const manager = vrmRuntime(rig)?.vrm.expressionManager;
 if (!manager) return;
 for (const [name, weight] of values) manager.setValue(name, weight);
 manager.update();
}
