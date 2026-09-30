// Serializable role tags bridge normalized VRM Object3D joints and the
// existing Mixamo physics vocabulary. No runtime objects enter userData.
export const isPoseBone = node => Boolean(node?.isBone || node?.userData?.studioBoneName);
export const canonicalBoneName = node => node?.userData?.studioBoneName ?? node?.userData?.studioRawBoneName ?? node?.name ?? '';

export const VRM_PHYSICS_BONES = Object.freeze([
  ['Hips', 'hips'], ['Spine', 'spine'], ['Spine1', 'chest'], ['Spine2', 'upperChest'],
  ['Neck', 'neck'], ['Head', 'head'],
  ...['Left','Right'].flatMap(side => {
    const s = side.toLowerCase();
    return [['Shoulder','Shoulder'],['Arm','UpperArm'],['ForeArm','LowerArm'],['Hand','Hand'],
      ['UpLeg','UpperLeg'],['Leg','LowerLeg'],['Foot','Foot'],['ToeBase','Toes']].map(([core,vrm]) => [side+core,s+vrm]);
  }),
  ...['Left','Right'].flatMap(side => ['Thumb','Index','Middle','Ring','Little'].flatMap(finger => {
    const core = finger === 'Little' ? 'Pinky' : finger;
    const parts = finger === 'Thumb' ? ['Metacarpal','Proximal','Distal'] : ['Proximal','Intermediate','Distal'];
    return parts.map((part,i) => [side+'Hand'+core+(i+1),side.toLowerCase()+finger+part]);
  })),
]);
