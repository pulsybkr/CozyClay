import { createCameraBlock } from './camera-block.js';
import { cameraMoveAt } from './camera-move.js';
import { createStableItemId } from './stable-items.js';

export const CAMERA_INTERPOLATIONS = ['smooth','linear','hold'];
export const SCENE_CAMERA_LIMIT = 32;
const copy = value => structuredClone(value);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const validId = id => typeof id === 'string' && id.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id);
const scopedKeyId = (shotId,keyId) => {
  let hash = 2166136261;
  for (const ch of `${shotId}:${keyId}`) hash = Math.imul(hash ^ ch.charCodeAt(0),16777619);
  return `camera-key:${shotId.slice(0,40)}:${keyId.slice(0,40)}:${(hash >>> 0).toString(16)}`;
};
export function validCameraFraming(value) {
  return value?.pos && ['x','y','z'].every(k => Number.isFinite(value.pos[k]))
    && ['yaw','pitch','fovDeg'].every(k => Number.isFinite(value[k])) && value.fovDeg >= 14 && value.fovDeg <= 90;
}
export function normalizeSceneCameras(entries) {
  const used = new Set(), result = [];
  for (const entry of Array.isArray(entries) ? entries.slice(0,SCENE_CAMERA_LIMIT) : []) {
    if (!entry || !validId(entry.id) || used.has(entry.id)) continue;
    const keys = new Map(), ids = new Set();
    for (const key of Array.isArray(entry.cameraKeys) ? entry.cameraKeys.slice(0,64) : []) {
      if (!Number.isInteger(key?.frame) || key.frame < 0 || key.frame > 28799 || !validCameraFraming(key.framing)) continue;
      let id = validId(key.id) ? key.id : createStableItemId('camera-key');
      if (ids.has(id)) id = createStableItemId('camera-key');
      ids.add(id);
      keys.set(key.frame,{id,frame:key.frame,framing:copy(key.framing)});
    }
    if (!keys.size) continue;
    used.add(entry.id);
    result.push({id:entry.id,name:typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0,128) : 'Camera',
      interpolation:CAMERA_INTERPOLATIONS.includes(entry.interpolation) ? entry.interpolation : 'smooth',
      camera:createCameraBlock(entry.camera),cameraKeys:[...keys.values()].sort((a,b)=>a.frame-b.frame)});
  }
  return result;
}

// Camera animation uses a local 24 fps clock. Each shot owns its cut/range;
// resolving the reference never interpolates between two shots.
export function resolveSceneCamera(shot,cameras) {
  const definition = cameras.find(camera => camera.id === shot.cameraId);
  if (!definition) {
    const {cameraId,cameraOffsetFrame,...fallback} = shot;
    return fallback;
  }
  const offset = Math.max(0,shot.cameraOffsetFrame ?? 0), length = shot.endFrame-shot.startFrame;
  const keys = definition.cameraKeys.map(key=>({...copy(key),interpolation:definition.interpolation}));
  const local = keys.filter(key=>key.frame >= offset && key.frame <= offset+length);
  const sample = at => cameraMoveAt(keys,{x:0,z:0},at);
  if (!local.some(key=>key.frame === offset)) local.unshift({id:'start',frame:offset,framing:sample(offset),interpolation:definition.interpolation});
  if (length > 0 && keys.some(key=>key.frame > offset+length) && !local.some(key=>key.frame === offset+length))
    local.push({id:'end',frame:offset+length,framing:sample(offset+length),interpolation:definition.interpolation});
  return {...shot,cameraId:definition.id,camera:copy(definition.camera),
    cameraAnimationKeys:keys.map(key=>({...key,frame:shot.startFrame+key.frame-offset})),
    cameraKeys:local.map(key=>({...key,id:scopedKeyId(shot.id,`${key.id}:${key.frame}`),frame:shot.startFrame+key.frame-offset}))};
}
export const resolveSceneCameras = (shots,cameras) => shots.map(shot => shot.cameraId ? resolveSceneCamera(shot,cameras) : shot);

export function detachSceneCamera(shot,anchor={x:0,z:0},filmback={}) {
  const {cameraId,cameraOffsetFrame,cameraAnimationKeys,...local} = shot;
  // When a cut uses only part of a longer camera move, retain its exact
  // production-frame samples rather than restarting the easing curve.
  if (cameraAnimationKeys?.length > 1 && cameraAnimationKeys.some(key=>key.frame < shot.startFrame || key.frame > shot.endFrame)) {
    local.cameraKeys = Array.from({length:shot.endFrame-shot.startFrame+1},(_,i)=>{
      const frame=shot.startFrame+i;
      return {id:createStableItemId('camera-key'),frame,interpolation:'linear',framing:copy(cameraMoveAt(cameraAnimationKeys,anchor,frame,filmback))};
    });
  }
  return local;
}

// Existing timeline/framing tools edit the linked definition. Changes to cut
// timing do not trim or retime the reusable camera's animation.
export function reconcileSceneCameraEdits(before,next) {
  let cameras = copy(next.cameras ?? before.cameras ?? []);
  if (!same(before.cameras,next.cameras ?? before.cameras)) return cameras;
  for (const shot of next.shots ?? []) {
    const prior = before.shots.find(row=>row.id === shot.id);
    if (!shot.cameraId || prior?.cameraId !== shot.cameraId || prior.startFrame !== shot.startFrame || prior.endFrame !== shot.endFrame) continue;
    const keyChange = !same(prior.cameraKeys,shot.cameraKeys), blockChange = !same(prior.camera,shot.camera);
    if (!keyChange && !blockChange) continue;
    cameras = cameras.map(camera => {
      if (camera.id !== shot.cameraId) return camera;
      const offset = Math.max(0,shot.cameraOffsetFrame ?? 0), end = offset+shot.endFrame-shot.startFrame;
      const untouched = camera.cameraKeys.filter(key=>key.frame < offset || key.frame > end);
      const updated = shot.cameraKeys.filter(key=>{
        const previous = prior.cameraKeys.find(row=>row.id === key.id);
        const boundary = previous && !prior.cameraAnimationKeys?.some(source=>source.frame === previous.frame);
        return !boundary || previous.frame !== key.frame || !same(previous.framing,key.framing);
      }).map(key=>{
        const previous = prior.cameraKeys.find(row=>row.id === key.id);
        const source = previous && prior.cameraAnimationKeys?.find(row=>row.frame === previous.frame);
        return {id:source?.id ?? key.id,frame:key.frame-shot.startFrame+offset,framing:copy(key.framing)};
      });
      return {...camera,...(blockChange ? {camera:copy(shot.camera)} : {}),
        ...(keyChange ? {cameraKeys:[...untouched,...updated]} : {})};
    });
  }
  return normalizeSceneCameras(cameras);
}
