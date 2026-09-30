import {useState,useSyncExternalStore} from 'react';
import {useBus} from '../app-context.js';
import Foldout from './Foldout.jsx';
import {vrmJobsSnapshot,subscribeVrmJobs} from '../vrm-generation.js';

export default function VrmGenerationPanel({hidden}) {
  const {run}=useBus(),jobs=useSyncExternalStore(subscribeVrmJobs,vrmJobsSnapshot,vrmJobsSnapshot);
  const [name,setName]=useState(''),[prompt,setPrompt]=useState(''),[gender,setGender]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const execute=async(action,args)=>{
    setBusy(true);setError('');
    try {
      let receipt=await run(action,args);
      if(receipt.ok && receipt.status==='started')receipt=await run('job.await',{jobId:receipt.jobId,timeoutMs:300000});
      if(!receipt.ok)setError(receipt.message || receipt.summary || 'VRM generation failed.');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <Foldout hidden={hidden} title="Générer un personnage VRM">
    <div className="vrm-generator" data-vrm-generator>
      <label>Nom<input aria-label="VRM name" maxLength={120} value={name} onChange={e=>setName(e.target.value)} /></label>
      <label>Description<textarea aria-label="VRM description" rows={4} maxLength={8000} placeholder="Apparence, coiffure, couleurs, tenue…" value={prompt} onChange={e=>setPrompt(e.target.value)} /></label>
      <label>Personnage<select aria-label="VRM gender" value={gender} onChange={e=>setGender(e.target.value)}><option value="">Choix selon la description</option><option value="female">Féminin</option><option value="male">Masculin</option></select></label>
      <button type="button" disabled={busy || !name.trim() || !prompt.trim()} onClick={()=>execute('character.generateVrm',{name:name.trim(),prompt:prompt.trim(),...(gender?{gender}:{})})}>Générer et ajouter à la scène</button>
      <p className="inspector-hint">Atelier crée le VRM ; Kimodo pourra ensuite animer son corps. Le suivi reprend un job existant sans relancer sa génération.</p>
      {jobs.slice().reverse().slice(0,8).map(job=><div className="vrm-job" key={job.jobId}>
        <strong>{job.name || 'Personnage'}</strong><span>{job.step}{job.progress!==null && job.progress!==undefined?` · ${job.progress} %`:''}</span>
        <progress max={100} {...(job.progress!==null && job.progress!==undefined?{value:job.progress}:{})} aria-label={`Progression ${job.name || job.jobId}`} />
        <small>{job.jobId}</small>
        {job.error && <p role="alert">{job.error}</p>}
        <button type="button" disabled={busy || job.status==='failed'} onClick={()=>execute('character.importVrmJob',{jobId:job.jobId,name:job.name || name.trim() || 'Personnage'})}>{job.status==='completed'?'Ajouter ce VRM à la scène':'Reprendre le suivi et ajouter'}</button>
      </div>)}
      {error && <p role="alert">{error}</p>}
    </div>
  </Foldout>;
}
