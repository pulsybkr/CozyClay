import { useState } from 'react';
import { useBus } from '../app-context.js';
import { ko } from '../locale.js';
import { Field } from '../ui.jsx';

export default function SceneCamerasPanel({cameras,activeShot,frame}) {
  const {run} = useBus();
  const [selectedId,setSelectedId] = useState(''), [keyFrame,setKeyFrame] = useState(0), [error,setError] = useState('');
  const selected = cameras.find(camera=>camera.id === selectedId) ?? cameras.find(camera=>camera.id === activeShot?.cameraId) ?? cameras[0];
  const selectedKey = selected?.cameraKeys.find(key=>key.frame === keyFrame) ?? selected?.cameraKeys[0];
  const command = (id,args) => {
    const receipt = run(id,args);
    setError(receipt.ok ? '' : receipt.message);
    return receipt;
  };
  const create = fromShot => {
    const receipt = command('camera.create',{name:`Camera ${cameras.length+1}`,...(fromShot && activeShot ? {shotId:activeShot.id} : {})});
    if (receipt.ok) { setSelectedId(receipt.affectedIds[0]); setKeyFrame(0); }
  };
  const editKey = (field,value) => {
    if (!Number.isFinite(value)) return setError(ko('Enter a valid number.','유효한 숫자를 입력하세요.'));
    const cameraKeys = selected.cameraKeys.map(key=>{
      if (key.id !== selectedKey.id) return key;
      if (field === 'frame') return {...key,frame:Math.round(value)};
      const framing = structuredClone(key.framing);
      if (['x','y','z'].includes(field)) framing.pos[field] = value;
      else framing[field] = ['yaw','pitch'].includes(field) ? value*Math.PI/180 : value;
      return {...key,framing};
    });
    const result = command('camera.set',{cameraId:selected.id,set:{cameraKeys}});
    if (result.ok && field === 'frame') setKeyFrame(Math.round(value));
  };
  return <section className="scene-cameras" data-scene-cameras>
    <h3>{ko('Scene cameras','장면 카메라')}</h3>
    <div className="scene-camera-buttons">
      <button type="button" disabled={cameras.length>=32} onClick={()=>create(false)}>{ko('New from view','현재 뷰로 생성')}</button>
      <button type="button" disabled={!activeShot || cameras.length>=32} onClick={()=>create(true)}>{ko('Save shot camera','샷 카메라 저장')}</button>
    </div>
    {cameras.length>0 && <>
      <Field label={ko('Camera','카메라')}><select aria-label="Scene camera" value={selected?.id ?? ''}
        onChange={event=>{setSelectedId(event.target.value);setKeyFrame(0);setError('');}}>
        {cameras.map(camera=><option key={camera.id} value={camera.id}>{camera.name}</option>)}
      </select></Field>
      <Field label={ko('Name','이름')}><input aria-label="Camera name" key={selected.id+selected.name} defaultValue={selected.name} maxLength={128}
        onBlur={event=>{if(event.target.value!==selected.name) command('camera.set',{cameraId:selected.id,set:{name:event.target.value}});}} /></Field>
      <div className="scene-camera-buttons">
        <button type="button" onClick={()=>command('camera.preview',{cameraId:selected.id,frame:selectedKey?.frame ?? 0})}>{ko('Preview','미리 보기')}</button>
        <button type="button" onClick={()=>{const r=command('camera.duplicate',{cameraId:selected.id});if(r.ok)setSelectedId(r.affectedIds[0]);}}>{ko('Duplicate','복제')}</button>
        <button type="button" onClick={()=>command('camera.remove',{cameraId:selected.id})}>{ko('Remove','삭제')}</button>
      </div>
      <Field label={ko('Current shot','현재 샷')}><select aria-label="Shot camera" disabled={!activeShot} value={activeShot?.cameraId ?? ''}
        onChange={event=>command('camera.assign',{shotId:activeShot.id,cameraId:event.target.value || null})}>
        <option value="">{ko('Local camera','로컬 카메라')}</option>
        {cameras.map(camera=><option key={camera.id} value={camera.id}>{camera.name}</option>)}
      </select></Field>
      <Field label={ko('Movement','움직임')}><select aria-label="Camera interpolation" value={selected.interpolation}
        onChange={event=>command('camera.set',{cameraId:selected.id,set:{interpolation:event.target.value}})}>
        <option value="smooth">{ko('Smooth start / stop','부드러운 시작 / 정지')}</option>
        <option value="linear">{ko('Constant progression','일정한 진행')}</option>
        <option value="hold">{ko('Hold until next key','다음 키까지 유지')}</option>
      </select></Field>
      <Field label={ko('Key','키')}><select aria-label="Camera key" value={selectedKey?.frame ?? 0} onChange={event=>setKeyFrame(Number(event.target.value))}>
        {selected.cameraKeys.map(key=><option key={key.id} value={key.frame}>{(key.frame/24).toFixed(2)} s · {key.frame}</option>)}
      </select></Field>
      {selectedKey && <div className="scene-camera-key-fields" key={selected.id+JSON.stringify(selectedKey)}>
        {[['frame',selectedKey.frame],...['x','y','z'].map(k=>[k,selectedKey.framing.pos[k]]),
          ['yaw',selectedKey.framing.yaw*180/Math.PI],['pitch',selectedKey.framing.pitch*180/Math.PI],['fovDeg',selectedKey.framing.fovDeg]].map(([field,value])=>
          <label key={field}>{field==='fovDeg' ? 'FOV °' : ['yaw','pitch'].includes(field) ? `${field} °` : field}
            <input aria-label={`Camera key ${field}`} type="number" step={field==='frame' ? 1 : .1} defaultValue={Number(value.toFixed(4))}
              onBlur={event=>{const next=Number(event.target.value);if(next!==Number(value.toFixed(4)))editKey(field,next);}} />
          </label>)}
      </div>}
      <div className="scene-camera-buttons">
        <button type="button" onClick={()=>command('camera.capture',{cameraId:selected.id,
          frame:activeShot?.cameraId===selected.id ? Math.max(0,frame-activeShot.startFrame+(activeShot.cameraOffsetFrame ?? 0)) : selectedKey?.frame ?? 0})}>{ko('Record view at playhead','플레이헤드에서 뷰 기록')}</button>
        <button type="button" disabled={selected.cameraKeys.length<=1} onClick={()=>command('camera.set',{cameraId:selected.id,
          set:{cameraKeys:selected.cameraKeys.filter(key=>key.id!==selectedKey.id)}})}>{ko('Remove key','키 삭제')}</button>
      </div>
      <p className="inspector-hint">{ko('Keys use local frames at 24 fps. Editing a shared camera updates every assigned shot; duplicate it for an independent variant.','키는 24fps 로컬 프레임을 사용합니다. 공유 카메라 편집은 연결된 모든 샷에 적용됩니다.')}</p>
    </>}
    {error && <p role="alert" className="scene-camera-error">{error}</p>}
  </section>;
}
