import { createStableItemId } from '../stable-items.js';
import { createCameraBlock } from '../camera-block.js';
import { normalizeSceneCameras, detachSceneCamera, CAMERA_INTERPOLATIONS, SCENE_CAMERA_LIMIT } from '../scene-cameras.js';
import { fail } from './shared.js';
import { registerElementKind } from './elements.js';
import { cameraMoveAt } from '../camera-move.js';
import { fovToFocalMm } from '../shot.js';

// Camera mutations have their own explicit schemas. Generic document reads
// still recognise the collection, without exposing an empty generic writer.
registerElementKind('camera',{collection:true,documentKey:'cameras',elements:[]});

const id = {type:'string',minLength:1,maxLength:120,pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]*$'}, name = {type:'string',minLength:1,maxLength:128};
const number = {type:'number'}, point = {type:'object',properties:{x:number,y:number,z:number},required:['x','y','z'],additionalProperties:false};
const framing = {type:'object',properties:{pos:point,yaw:number,pitch:number,fovDeg:{type:'number',minimum:14,maximum:90}},required:['pos','yaw','pitch','fovDeg'],additionalProperties:false};
const input = (properties,required=Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
const key = input({id,frame:{type:'integer',minimum:0,maximum:28799},framing},['frame','framing']);
const mutation = (id,label,schema) => ({id,label,description:label,kind:'mutation',undoDomain:'shot',input:schema});
export const declarations = Object.freeze([
  mutation('camera.create','Create a named camera from the current framing or a shot',input({name,cameraId:id,shotId:id},['name'])),
  mutation('camera.set','Edit a reusable camera; key frames are LOCAL to each assigned shot, at 24 fps',input({cameraId:id,set:input({name,
    mode:{type:'string',enum:['keys','follow','rail']},interpolation:{type:'string',enum:CAMERA_INTERPOLATIONS},cameraKeys:{type:'array',minItems:1,maxItems:64,items:key}},[]) })),
  mutation('camera.assign','Select a camera for a shot; null detaches it and keeps its current movement',input({shotId:id,cameraId:{oneOf:[id,{type:'null'}]}})),
  mutation('camera.capture','Key the current framing on a named camera at a LOCAL frame',input({cameraId:id,frame:{type:'integer',minimum:0,maximum:28799}})),
  mutation('camera.duplicate','Duplicate a camera independently',input({cameraId:id,name},['cameraId'])),
  mutation('camera.remove','Remove a camera and preserve its assigned shots as local camera movements',input({cameraId:id})),
  {id:'camera.preview',label:'Preview a named camera',description:'Preview without changing shot assignments. Frame is local to the camera.',kind:'transient',
    input:input({cameraId:id,frame:{type:'integer',minimum:0,maximum:28799,default:0}},['cameraId'])},
]);
export function register(registry,ports) {
  const owner = () => ports.storeDomain('shot');
  const cameraOf = id => owner().state().cameras.find(camera=>camera.id === id) ?? fail('STALE_TARGET',`Unknown camera: ${id}`);
  const shotOf = id => owner().read().find(shot=>shot.id === id) ?? fail('STALE_TARGET',`Unknown shot: ${id}`);
  for (const declaration of declarations) registry.register({...declaration,
    available:()=>Boolean(ports.storeDomain?.('shot')) || 'The shot document is not mounted.',
    run(args) {
      if (declaration.id === 'camera.preview') {
        const definition = cameraOf(args.cameraId), state = owner().cameraContext(), anchor = state.characters[0] ?? {x:0,z:0};
        const framing = cameraMoveAt(definition.cameraKeys.map(key=>({...key,interpolation:definition.interpolation})),anchor,args.frame ?? 0,state.filmback);
        const pos = framing.pos, cp = Math.cos(framing.pitch);
        owner().renderCamera({position:pos,lookAt:{x:pos.x-Math.sin(framing.yaw)*cp,y:pos.y+Math.sin(framing.pitch),z:pos.z-Math.cos(framing.yaw)*cp},
          focalMm:fovToFocalMm(framing.fovDeg*Math.PI/180,state.filmback.sensorId,state.filmback.aspectRatio),sensorId:state.filmback.sensorId,slate:definition.name},true,framing.fovDeg);
        return {affectedIds:[definition.id],summary:`Previewing ${definition.name}.`};
      }
      const before = owner().state(), affected = new Set();
      const state = owner().cameraContext(), anchor = state.characters[0] ?? {x:0,z:0};
      const detach = shot => detachSceneCamera(shot,anchor,state.filmback);
      let cameras = before.cameras, shots = before.shots;
      if (['camera.create','camera.duplicate'].includes(declaration.id)) {
        if (cameras.length >= SCENE_CAMERA_LIMIT) fail('INVALID_ARGUMENT',`At most ${SCENE_CAMERA_LIMIT} scene cameras are supported.`);
        const shot = args.shotId ? shotOf(args.shotId) : null;
        const source = declaration.id === 'camera.duplicate' ? structuredClone(cameraOf(args.cameraId)) : shot?.cameraId ? structuredClone(cameraOf(shot.cameraId)) : null;
        if (args.name !== undefined && !args.name.trim()) fail('INVALID_ARGUMENT','Camera name cannot be blank.');
        if (!source && shot?.cameraKeys.length > 64) fail('INVALID_ARGUMENT','Reduce the shot movement to at most 64 keys before saving a named camera.');
        const capture = source ? null : owner().capture();
        const cameraId = declaration.id === 'camera.create' ? args.cameraId ?? createStableItemId('camera') : createStableItemId('camera');
        if ([...cameras,...shots,...ports.state().characters,...ports.state().objects].some(row=>row.id === cameraId)) fail('DUPLICATE_NAME','This camera id is already used.');
        const camera = source ? {...source,id:cameraId,name:args.name ?? `${source.name} copy`} : {id:cameraId,name:args.name,interpolation:'smooth',
          camera:createCameraBlock(shot?.camera),cameraKeys:shot?.cameraKeys.length ? shot.cameraKeys.map(key=>({id:createStableItemId('camera-key'),
            frame:key.frame-shot.startFrame,framing:structuredClone(key.framing)})) : [{id:createStableItemId('camera-key'),frame:0,framing:capture}]};
        const valid = normalizeSceneCameras([camera])[0];
        if (!valid) fail('TARGET_NOT_READY','A valid shot framing is required to create a camera.');
        cameras = [...cameras,valid]; affected.add(cameraId);
        if (shot) { shots = shots.map(row=>row.id === shot.id ? {...row,cameraId,cameraOffsetFrame:source ? shot.cameraOffsetFrame ?? 0 : 0} : row); affected.add(shot.id); }
      } else if (declaration.id === 'camera.assign') {
        const shot = shotOf(args.shotId); if (args.cameraId !== null) cameraOf(args.cameraId);
        shots = shots.map(row=>{
          if (row.id !== shot.id) return row;
          if (args.cameraId !== null) return {...row,cameraId:args.cameraId,cameraOffsetFrame:0};
          return detach(row);
        }); affected.add(shot.id);
      } else {
        const camera = cameraOf(args.cameraId); affected.add(camera.id);
        for (const shot of shots.filter(shot=>shot.cameraId === camera.id)) affected.add(shot.id);
        if (declaration.id === 'camera.remove') {
          cameras = cameras.filter(row=>row.id !== camera.id);
          shots = shots.map(row=>row.cameraId === camera.id ? detach(row) : row);
        } else {
          const patch = declaration.id === 'camera.capture' ? {cameraKeys:[...camera.cameraKeys.filter(key=>key.frame !== args.frame),
            {id:camera.cameraKeys.find(key=>key.frame === args.frame)?.id ?? createStableItemId('camera-key'),frame:args.frame,framing:owner().capture()}]} : args.set;
          if (patch.name !== undefined && !patch.name.trim()) fail('INVALID_ARGUMENT','Camera name cannot be blank.');
          const {mode,...definitionPatch} = patch;
          const valid = normalizeSceneCameras([{...camera,...definitionPatch,camera:mode ? {...camera.camera,mode} : camera.camera}])[0];
          if (!valid || (patch.cameraKeys && valid.cameraKeys.length !== patch.cameraKeys.length)) fail('INVALID_ARGUMENT','Camera keys must have unique frames and valid framings.');
          cameras = cameras.map(row=>row.id === camera.id ? valid : row);
        }
      }
      owner().writeState({...before,cameras,shots});
      return {affectedIds:[...affected],summary:`${declaration.label}.`};
    }
  });
}
